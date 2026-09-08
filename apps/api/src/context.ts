import type { ArtifactService } from '@orbit/artifact-service';
import type { OrbitRepositories } from '@orbit/db';
import type { ModelBudgets } from '@orbit/sop-generation';
import type {
  PublishBoundDocumentService,
  PublishRecordingService,
  RecoveryProposalService,
  SopCandidateService,
  SopDraftService,
  SopPublishService,
  SopRevisionService,
} from '@orbit/sop-service';

import type { BindingSessionRegistry } from './recording/binding-session-registry';
import type { RecordingSessionRegistry } from './recording/session-registry';
import type { WalkthroughSessionRegistry } from './recording/walkthrough-session-registry';

import type { RunDispatcher } from './dispatch';

/**
 * Everything the routes are allowed to touch.
 *
 * Every member is an interface, so the whole HTTP surface can be exercised
 * against fakes — request validation and error envelopes are tested with no
 * database and no browser at all, and the database-backed tests supply the real
 * implementations.
 */
export interface ApiContext {
  readonly repositories: OrbitRepositories;
  readonly artifactService: ArtifactService;
  readonly dispatcher: RunDispatcher;
  /**
   * SOP draft generation.
   *
   * An interface like every other member, which is the whole reason the
   * end-to-end stack can run against a deterministic fake provider without the
   * shipped entry point knowing that one exists.
   */
  readonly sopDraftService: SopDraftService;
  /** Review, editing, reorder, clarification and lifecycle (sub-phase 2.3). */
  readonly sopRevisionService: SopRevisionService;
  /** Compiling an approved revision into candidate Agent IR, and approving it (sub-phase 2.5). */
  readonly sopCandidateService: SopCandidateService;
  readonly sopPublishService: SopPublishService;
  /** Approve, compile, approve and publish a recorded workflow in one call. */
  readonly publishRecordingService: PublishRecordingService;
  /** The same, for a drafted workflow whose every step has been bound (ADR-027). */
  readonly publishBoundDocumentService: PublishBoundDocumentService;
  /**
   * Bounded recovery proposals: reading them, accepting one, dismissing one,
   * and granting or withdrawing the capability per document (ADR-033).
   *
   * Accepting is the only write in Orbit that turns a proposal into a mapping,
   * and it goes through the ordinary binding lifecycle rather than around it.
   */
  readonly recoveryProposals: RecoveryProposalService;
  /**
   * Recording sessions the API is holding open.
   *
   * The one member backed by a live browser, which is why the capability is
   * confined to `src/recording/` (ADR-020).
   */
  readonly recordingSessions: RecordingSessionRegistry;
  /**
   * Binding sessions the API is holding open.
   *
   * The second member backed by a live browser, and confined to the same one
   * directory for the same reason (ADR-020, ADR-027).
   */
  readonly bindingSessions: BindingSessionRegistry;
  /**
   * Walkthrough sessions the API is holding open (ADR-035).
   *
   * The third, and the last one this directory's exemption covers: one browser
   * in which a person performs the whole task, aligned afterwards against the
   * steps still waiting to be bound. It writes proposals and never a binding.
   */
  readonly walkthroughSessions: WalkthroughSessionRegistry;
  /**
   * The token ceilings this deployment is running with (ADR-029).
   *
   * Here so the read route can report headroom. The *enforcement* lives in the
   * draft service, which is given the same object: the route reports, and the
   * server refuses, and the two read the same numbers rather than each holding
   * their own.
   */
  readonly modelBudgets: ModelBudgets;
}
