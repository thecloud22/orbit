import type { ArtifactId, ArtifactLink, ArtifactMetadata, RunId } from '@orbit/contracts';

import type { ApiContext } from '../app/context';
import { notFound } from '../errors';

/**
 * Artifact access control for Phase 1.
 *
 * There is no authentication yet, so the one authorization question the API can
 * answer honestly is: *is this artifact evidence of this run?* Everything is
 * addressed by opaque id — a caller never supplies a storage key, a filename, or
 * a path, so there is nothing here to traverse.
 *
 * An artifact that does not exist and an artifact that exists but belongs to
 * another run produce the identical 404, so the route cannot be used to discover
 * which artifact ids are real.
 */
export async function loadArtifactForRun(
  context: ApiContext,
  runId: RunId,
  artifactId: ArtifactId,
): Promise<{ readonly artifact: ArtifactMetadata; readonly links: readonly ArtifactLink[] }> {
  const artifact = await context.repositories.artifacts.findById(artifactId);

  if (artifact === null) {
    throw notFound('No such artifact for this run.');
  }

  const links = await context.repositories.artifacts.listLinksForArtifact(artifactId);

  if (!(await isLinkedToRun(context, runId, artifact, links))) {
    throw notFound('No such artifact for this run.');
  }

  return { artifact, links };
}

/**
 * Accepts ownership by the run itself, or a link to the run, one of its steps,
 * or one of its events — the three link targets the evidence contract defines.
 */
async function isLinkedToRun(
  context: ApiContext,
  runId: RunId,
  artifact: ArtifactMetadata,
  links: readonly ArtifactLink[],
): Promise<boolean> {
  if (artifact.runId === runId) {
    return true;
  }

  if (links.some((link) => link.targetType === 'run' && link.targetId === runId)) {
    return true;
  }

  const stepLinks = links.filter((link) => link.targetType === 'run_step');
  if (stepLinks.length > 0) {
    const steps = await context.repositories.runSteps.listByRun(runId);
    const stepIds = new Set(steps.map((step) => step.id));

    if (stepLinks.some((link) => stepIds.has(link.targetId))) {
      return true;
    }
  }

  const eventLinks = links.filter((link) => link.targetType === 'run_event');
  if (eventLinks.length > 0) {
    const events = await context.repositories.runEvents.listByRun(runId);
    const eventIds = new Set(events.map((event) => event.id));

    if (eventLinks.some((link) => eventIds.has(link.targetId))) {
      return true;
    }
  }

  return false;
}
