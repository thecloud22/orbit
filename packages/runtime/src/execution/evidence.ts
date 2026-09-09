import type { AgentIr, AgentIrStep } from '@orbit/agent-ir';
import type { ArtifactKind, ArtifactLinkRole, RunStepId } from '@orbit/contracts';

import { RuntimeError, describeCause } from '../errors';
import type { RuntimeLogger } from '../logger';
import type { BrowserExecutor, RecordedArtifact, RunRecorder } from '../ports';

/**
 * The Phase 1 evidence policy.
 *
 * Kinds and roles are not the same thing: a screenshot is always the artifact
 * kind `browser_screenshot`, while `screenshot_after_action` and `error_context`
 * are two different reasons it is attached. Both vocabularies come from
 * @orbit/contracts unchanged; nothing here invents a value.
 */

export type EvidenceCapture = 'screenshot' | 'dom_snapshot';

export interface EvidenceEntry {
  readonly capture: EvidenceCapture;
  readonly kind: ArtifactKind;
  readonly role: ArtifactLinkRole;
}

const SCREENSHOT_AFTER_ACTION: EvidenceEntry = {
  capture: 'screenshot',
  kind: 'browser_screenshot',
  role: 'screenshot_after_action',
};

const DOM_AFTER_ACTION: EvidenceEntry = {
  capture: 'dom_snapshot',
  kind: 'dom_snapshot',
  role: 'dom_snapshot',
};

const SCREENSHOT_ERROR_CONTEXT: EvidenceEntry = {
  capture: 'screenshot',
  kind: 'browser_screenshot',
  role: 'error_context',
};

const DOM_ERROR_CONTEXT: EvidenceEntry = {
  capture: 'dom_snapshot',
  kind: 'dom_snapshot',
  role: 'error_context',
};

function grants(agentIr: AgentIr, capture: EvidenceCapture): boolean {
  // An agent that declares no browser section has been granted nothing on that
  // surface, so it captures no browser evidence. Absent means denied, here as
  // everywhere else in `permissions` (ADR-037).
  const granted = agentIr.permissions.browser?.allowedActions ?? [];
  return capture === 'screenshot'
    ? granted.includes('screenshot')
    : granted.includes('dom_snapshot');
}

/**
 * Evidence for a step that succeeded.
 *
 * Ordinary steps capture exactly what their IR declares. A terminal `complete`
 * step additionally captures the final result state, which CLAUDE.md requires of
 * every run but the IR has no field to declare — gated on the same permission
 * grants, so it can never exceed what the Agent Version was granted.
 */
export function successEvidence(step: AgentIrStep, agentIr: AgentIr): readonly EvidenceEntry[] {
  if (step.type === 'complete') {
    return [
      ...(grants(agentIr, 'screenshot') ? [SCREENSHOT_AFTER_ACTION] : []),
      ...(grants(agentIr, 'dom_snapshot') ? [DOM_AFTER_ACTION] : []),
    ];
  }

  const declared = 'evidence' in step ? step.evidence : undefined;

  return [
    ...(declared?.captureScreenshot === true ? [SCREENSHOT_AFTER_ACTION] : []),
    ...(declared?.captureDomSnapshot === true ? [DOM_AFTER_ACTION] : []),
  ];
}

/** Diagnostic evidence for a step that failed. Always best effort. */
export function failureEvidence(agentIr: AgentIr): readonly EvidenceEntry[] {
  return [
    ...(grants(agentIr, 'screenshot') ? [SCREENSHOT_ERROR_CONTEXT] : []),
    ...(grants(agentIr, 'dom_snapshot') ? [DOM_ERROR_CONTEXT] : []),
  ];
}

export interface CaptureEvidenceOptions {
  /**
   * The browser session, when one was opened for this run.
   *
   * Absent means there is nothing to capture from: every evidence entry defined
   * today is a browser capture. It is not an error -- a workflow can legitimately
   * open no browser (ADR-037).
   */
  readonly executor: BrowserExecutor | undefined;
  readonly recorder: RunRecorder;
  readonly entries: readonly EvidenceEntry[];
  readonly agentStepId: string;
  readonly runStepId: RunStepId;
  readonly logger: RuntimeLogger;
  /**
   * `required` is the success path: a failure to capture, store, or link
   * evidence fails the step, because a run that succeeded without its required
   * evidence is not a run Orbit can prove anything about.
   *
   * `best_effort` is the failure path: capture problems are logged and
   * discarded so a secondary evidence failure can never mask, replace, or
   * upgrade the primary browser failure that is already being recorded.
   */
  readonly mode: 'required' | 'best_effort';
}

export async function captureEvidence(
  options: CaptureEvidenceOptions,
): Promise<readonly RecordedArtifact[]> {
  const recorded: RecordedArtifact[] = [];
  const executor = options.executor;

  // Nothing to capture from. Every entry defined today is a browser capture, so
  // a run that opened no browser has no evidence to take rather than a failure
  // to report.
  if (executor === undefined) {
    return recorded;
  }

  for (const entry of options.entries) {
    try {
      const bytes =
        entry.capture === 'screenshot'
          ? await executor.captureScreenshot()
          : new TextEncoder().encode(await executor.captureDom());

      recorded.push(
        await options.recorder.recordArtifact({
          kind: entry.kind,
          role: entry.role,
          bytes,
          runStepId: options.runStepId,
          agentStepId: options.agentStepId,
        }),
      );
    } catch (error) {
      if (options.mode === 'required') {
        throw new RuntimeError({
          code: 'ARTIFACT_STORAGE_ERROR',
          message: `Step "${options.agentStepId}" could not persist its required ${entry.kind} evidence.`,
          details: [{ field: 'artifact.role', message: entry.role }],
          agentStepId: options.agentStepId,
          cause: error,
        });
      }

      options.logger.warn(
        {
          agentStepId: options.agentStepId,
          artifactKind: entry.kind,
          artifactRole: entry.role,
          cause: describeCause(error),
        },
        'Best-effort failure evidence could not be captured; the original failure is unchanged.',
      );
    }
  }

  return recorded;
}
