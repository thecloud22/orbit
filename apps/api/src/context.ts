import type { ArtifactService } from '@orbit/artifact-service';
import type { OrbitRepositories } from '@orbit/db';
import type {
  PublishRecordingService,
  SopCandidateService,
  SopDraftService,
  SopPublishService,
  SopRevisionService,
} from '@orbit/sop-service';

import type { RecordingSessionRegistry } from './recording/session-registry';

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
  /**
   * Recording sessions the API is holding open.
   *
   * The one member backed by a live browser, which is why the capability is
   * confined to `src/recording/` (ADR-020).
   */
  readonly recordingSessions: RecordingSessionRegistry;
}
