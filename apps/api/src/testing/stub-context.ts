import type { ArtifactService } from '@orbit/artifact-service';
import type {
  AgentRepository,
  AgentVersionRepository,
  ArtifactRepository,
  RunEventRepository,
  RunRepository,
  RunStepRepository,
} from '@orbit/db';

import type { ApiContext } from '../context';
import type { RunDispatcher } from '../dispatch';

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
  readonly artifactService?: Partial<ArtifactService>;
  readonly dispatcher?: Partial<RunDispatcher>;
}

export function createStubContext(options: StubContextOptions = {}): ApiContext {
  return {
    repositories: {
      agents: stubbed('agents', options.agents ?? {}),
      agentVersions: stubbed('agentVersions', options.agentVersions ?? {}),
      runs: stubbed('runs', options.runs ?? {}),
      runSteps: stubbed('runSteps', options.runSteps ?? {}),
      runEvents: stubbed('runEvents', options.runEvents ?? {}),
      artifacts: stubbed('artifacts', options.artifacts ?? {}),
    },
    artifactService: stubbed('artifactService', options.artifactService ?? {}),
    dispatcher: stubbed('dispatcher', options.dispatcher ?? {}),
  };
}
