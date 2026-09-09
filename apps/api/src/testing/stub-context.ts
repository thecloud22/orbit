import type { ArtifactService } from '@orbit/artifact-service';
import type {
  AgentIrCandidateRepository,
  AgentRepository,
  AgentVersionRepository,
  ArtifactRepository,
  BindingRecoveryProposalRepository,
  ExecutionBindingRepository,
  ModelUsageRepository,
  OrbitRepositories,
  RunEventRepository,
  RunRepository,
  RunStepRepository,
  SopDocumentRepository,
  SopGraphRevisionRepository,
} from '@orbit/db';

import type { ModelBudgets } from '@orbit/sop-generation';

import type {
  PublishBoundDocumentService,
  PublishRecordingService,
  RecoveryProposalService,
  SopCandidateService,
  SopDraftService,
  SopRuleService,
  SopPublishService,
  SopRevisionService,
} from '@orbit/sop-service';

import type { BindingSessionRegistry } from '../recording/binding-session-registry';
import type { WalkthroughSessionRegistry } from '../recording/walkthrough-session-registry';
import type { RecordingSessionRegistry } from '../recording/session-registry';

import type { ApiContext, BindingReviewService } from '../app/context';
import type { PlatformFacts } from '../app/platform';
import type { RunDispatcher } from '../runs/dispatch';

/**
 * A context whose every member throws unless a test stubbed it.
 *
 * The point is that a test states exactly which calls the route under test is
 * allowed to make. An unstubbed call fails loudly with the method name rather
 * than returning `undefined` and letting the route appear to work.
 */
function stubbed<T extends object>(name: string, overrides: Partial<T>): T {
  return new Proxy(
    {},
    {
      get(_target, property) {
        const key = String(property);
        const override = (overrides as Record<string, unknown>)[key];

        if (override !== undefined) {
          return override;
        }

        return () => {
          throw new Error(`${name}.${key}() is not stubbed in this test.`);
        };
      },
    },
  ) as T;
}

export interface StubContextOptions {
  readonly agents?: Partial<AgentRepository>;
  readonly agentVersions?: Partial<AgentVersionRepository>;
  readonly runs?: Partial<RunRepository>;
  readonly runSteps?: Partial<RunStepRepository>;
  readonly runEvents?: Partial<RunEventRepository>;
  readonly artifacts?: Partial<ArtifactRepository>;
  readonly executionBindings?: Partial<ExecutionBindingRepository>;
  readonly agentIrCandidates?: Partial<AgentIrCandidateRepository>;
  readonly modelUsage?: Partial<ModelUsageRepository>;
  readonly sopDocuments?: Partial<SopDocumentRepository>;
  readonly sopGraphRevisions?: Partial<SopGraphRevisionRepository>;
  readonly artifactService?: Partial<ArtifactService>;
  readonly dispatcher?: Partial<RunDispatcher>;
  readonly sopDraftService?: Partial<SopDraftService>;
  readonly sopRuleService?: Partial<SopRuleService>;
  readonly sopRevisionService?: Partial<SopRevisionService>;
  readonly sopCandidateService?: Partial<SopCandidateService>;
  readonly sopPublishService?: Partial<SopPublishService>;
  readonly publishRecordingService?: Partial<PublishRecordingService>;
  readonly publishBoundDocumentService?: Partial<PublishBoundDocumentService>;
  readonly recoveryProposals?: Partial<RecoveryProposalService>;
  readonly recordingSessions?: Partial<RecordingSessionRegistry>;
  readonly bindingSessions?: Partial<BindingSessionRegistry>;
  readonly walkthroughSessions?: Partial<WalkthroughSessionRegistry>;
  readonly bindingRecoveryProposals?: Partial<BindingRecoveryProposalRepository>;
  readonly modelBudgets?: ModelBudgets;
  readonly platform?: Partial<PlatformFacts>;
  readonly apiSystems?: Partial<OrbitRepositories['apiSystems']>;
  readonly bindingReview?: Partial<BindingReviewService>;
}

export function createStubContext(options: StubContextOptions = {}): ApiContext {
  return {
    // Uncapped by default: a route test asserting request validation should not
    // have to know what a budget is.
    modelBudgets: options.modelBudgets ?? {},
    repositories: {
      agents: stubbed('agents', options.agents ?? {}),
      agentVersions: stubbed('agentVersions', options.agentVersions ?? {}),
      runs: stubbed('runs', options.runs ?? {}),
      runSteps: stubbed('runSteps', options.runSteps ?? {}),
      runEvents: stubbed('runEvents', options.runEvents ?? {}),
      artifacts: stubbed('artifacts', options.artifacts ?? {}),
      // Present so the context satisfies OrbitRepositories. No route reaches SOP
      // persistence directly — the draft route goes through `sopDraftService`
      // below — so any call here is a test reaching somewhere it should not, and
      // it fails loudly with the method name.
      sopDocuments: stubbed('sopDocuments', options.sopDocuments ?? {}),
      sopGraphRevisions: stubbed('sopGraphRevisions', options.sopGraphRevisions ?? {}),
      executionBindings: stubbed('executionBindings', options.executionBindings ?? {}),
      modelUsage: stubbed('modelUsage', options.modelUsage ?? {}),
      apiSystems: stubbed('apiSystems', options.apiSystems ?? {}),
      agentIrCandidates: stubbed('agentIrCandidates', options.agentIrCandidates ?? {}),
      bindingRecoveryProposals: stubbed(
        'bindingRecoveryProposals',
        options.bindingRecoveryProposals ?? {},
      ),
    },
    platform: stubbed('platform', options.platform ?? {}),
    bindingReview: stubbed('bindingReview', options.bindingReview ?? {}),
    artifactService: stubbed('artifactService', options.artifactService ?? {}),
    dispatcher: stubbed('dispatcher', options.dispatcher ?? {}),
    sopDraftService: stubbed('sopDraftService', options.sopDraftService ?? {}),
    sopRuleService: stubbed('sopRuleService', options.sopRuleService ?? {}),
    sopRevisionService: stubbed('sopRevisionService', options.sopRevisionService ?? {}),
    sopCandidateService: stubbed('sopCandidateService', options.sopCandidateService ?? {}),
    sopPublishService: stubbed('sopPublishService', options.sopPublishService ?? {}),
    publishRecordingService: stubbed(
      'publishRecordingService',
      options.publishRecordingService ?? {},
    ),
    recoveryProposals: stubbed('recoveryProposals', options.recoveryProposals ?? {}),
    publishBoundDocumentService: stubbed(
      'publishBoundDocumentService',
      options.publishBoundDocumentService ?? {},
    ),
    recordingSessions: stubbed('recordingSessions', options.recordingSessions ?? {}),
    bindingSessions: stubbed('bindingSessions', options.bindingSessions ?? {}),
    walkthroughSessions: stubbed('walkthroughSessions', options.walkthroughSessions ?? {}),
  };
}
