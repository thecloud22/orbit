/**
 * The handbook, as typed data.
 *
 * Content lives here rather than in markdown files read at runtime for one
 * reason: everything below is a claim about this deployment, and a claim that
 * cannot be type-checked or tested is a claim that quietly goes stale. A topic
 * is a value, its links are `View`s the router already understands, and
 * `wiki-content.test.ts` asserts the invariants — unique ids, no empty
 * sections, every cross-reference resolving — that a prose file cannot state
 * about itself.
 *
 * The scope is deliberately narrow. This is task-oriented help — how to record,
 * bind, publish, run, read evidence, answer a recovery proposal — and it points
 * at `docs/` for contracts and architecture rather than restating them. A wiki
 * that duplicates the architecture documents becomes a second source of truth
 * that drifts from the first.
 */

/** One renderable piece of a topic. A closed set, so the renderer is exhaustive. */
export type WikiBlock =
  | { readonly kind: 'paragraph'; readonly text: string }
  | { readonly kind: 'heading'; readonly text: string }
  /** An ordered procedure. Rendered numbered, because the order matters. */
  | { readonly kind: 'steps'; readonly items: readonly string[] }
  /** An unordered set of facts. Rendered bulleted. */
  | { readonly kind: 'list'; readonly items: readonly string[] }
  /** Shell or URL text, shown verbatim. Never interpolated. */
  | { readonly kind: 'code'; readonly lines: readonly string[] }
  /** A two-column reference table. */
  | {
      readonly kind: 'table';
      readonly columns: readonly [string, string];
      readonly rows: readonly (readonly [string, string])[];
    }
  /** Something that will otherwise be learned the hard way. */
  | { readonly kind: 'note'; readonly text: string }
  /** A limitation stated plainly rather than discovered. */
  | { readonly kind: 'limitation'; readonly text: string };

export interface WikiTopic {
  /** Stable; it is the `topic` query parameter, so changing one breaks links. */
  readonly id: string;
  readonly title: string;
  /** One line, shown on the index. */
  readonly summary: string;
  readonly blocks: readonly WikiBlock[];
  /** Ids of other topics worth reading next. Verified to resolve, by test. */
  readonly seeAlso?: readonly string[];
}

const gettingStarted: WikiTopic = {
  id: 'getting-started',
  title: 'What Orbit is, and the two ways in',
  summary: 'The loop a workflow travels, from a demonstration to a run you can audit.',
  blocks: [
    {
      kind: 'paragraph',
      text: 'Orbit turns a business procedure into an agent that runs it in a real browser and leaves evidence of everything it did. The procedure stays readable business intent; what executes is a separate, typed, version-pinned artifact compiled from it.',
    },
    {
      kind: 'code',
      lines: [
        'free text, or a recorded demonstration',
        '  -> SOP Graph revision      (immutable, checksummed, non-executable)',
        '  -> Execution Bindings      (which element each step acts on)',
        '  -> candidate Agent IR      (compiled; refused when not fully understood)',
        '  -> published Agent Version (immutable)',
        '  -> a run in real Chromium',
        '  -> events, artifacts, evidence',
      ],
    },
    { kind: 'heading', text: 'The two ways to start' },
    {
      kind: 'list',
      items: [
        'Record yourself doing it. Do the task once in a browser Orbit opens. It captures each step and the exact element you acted on, so it knows where as well as what.',
        'Describe it in your own words. Write the procedure as you would explain it to a new colleague. Orbit proposes a structured workflow you review and correct.',
      ],
    },
    {
      kind: 'paragraph',
      text: 'Neither is the fallback for the other. Describing is faster; showing is exact. Both land in the same place — a document in Studio, with the same tables and the same validation behind it.',
    },
    { kind: 'heading', text: 'Where things are' },
    {
      kind: 'table',
      columns: ['Place', 'What it holds'],
      rows: [
        ['Home', 'What Orbit is, the two ways in, and what is going on right now'],
        ['Studio', 'Everything drafted or recorded, on its way to becoming an agent'],
        ['Agents', 'Published Agent Versions — what can actually be run'],
        ['Runs', 'Every run, newest first, and the evidence each one left'],
      ],
    },
  ],
  seeAlso: ['record-a-workflow', 'describe-a-workflow', 'publish-and-run'],
};

const recordAWorkflow: WikiTopic = {
  id: 'record-a-workflow',
  title: 'Record a workflow',
  summary: 'Perform the task once; Orbit captures the steps and the elements together.',
  blocks: [
    {
      kind: 'steps',
      items: [
        'On Home, give the recording a title and the URL it should start at.',
        'Start it. A real browser opens and you do the task in it.',
        'Watch the live page list what has been captured as you go.',
        'Press Finish. Orbit compiles the sequence and opens the new document in Studio.',
      ],
    },
    {
      kind: 'note',
      text: 'The browser opens on the machine running the Orbit API, because somebody has to see and click the page. Pointed at a remote API from a laptop, no window appears on the laptop.',
    },
    { kind: 'heading', text: 'What a recording can and cannot produce' },
    {
      kind: 'paragraph',
      text: 'A recording produces a linear draft. One walk through a task takes one path, so it cannot honestly produce a branch nobody took — decisions are added afterwards on the review page. An outcome step is appended automatically, because a recording ends when you stop and every path has to reach a terminal.',
    },
    {
      kind: 'limitation',
      text: 'If the sequence cannot become a valid workflow, the session stays open and says why. That is deliberate: the browser still holds the work, which is the one thing here you cannot repeat from memory. An idle session closes after thirty minutes, and any still open when the API stops go with it.',
    },
    { kind: 'heading', text: 'Passwords' },
    {
      kind: 'paragraph',
      text: 'A value typed into a password field never leaves the page. The recorder reports that the field was filled without the value, and the translator declares a secret input and points the step at it. A recorded sign-in therefore arrives with its secret properly declared rather than with a credential sitting in a durable artifact.',
    },
    { kind: 'heading', text: 'From a terminal instead' },
    {
      kind: 'code',
      lines: [
        'pnpm record:workflow -- --title "Find a service request" \\',
        '  --start-url http://localhost:3001/requests',
      ],
    },
    {
      kind: 'paragraph',
      text: 'Recording may target any http or https URL, including a real website, because a person is driving the browser. Other protocols — file:, data:, javascript: — are refused before a browser opens. What the resulting agent may open on its own is a separate and much narrower question.',
    },
  ],
  seeAlso: ['bindings', 'review-a-workflow', 'publish-and-run'],
};

const describeAWorkflow: WikiTopic = {
  id: 'describe-a-workflow',
  title: 'Describe a workflow in words',
  summary: 'Write the procedure out; Orbit proposes a structured graph to correct.',
  blocks: [
    {
      kind: 'steps',
      items: [
        'On Home, write the procedure in the drafting box the way you would explain it to a colleague.',
        'Generate. Orbit reads it and proposes a structured workflow.',
        'Open the draft in Studio and correct it — edit steps, reorder them, insert one, answer the clarifying questions it raises.',
        'Approve the revision when it says what you mean.',
      ],
    },
    {
      kind: 'paragraph',
      text: 'What comes back is re-parsed through the same validator that guards every other document before anything is stored. A model proposes; it never writes directly into the graph.',
    },
    {
      kind: 'limitation',
      text: 'A drafted workflow has no bindings. It says "the field labelled Request number" and nothing yet says which element that is. Binding is a separate, human step — see the bindings topic.',
    },
    {
      kind: 'note',
      text: 'Drafting spends model tokens and is metered. Home shows what has been spent against the deployment-wide ceiling. If a Generate is refused for budget, that is the ceiling doing its job.',
    },
  ],
  seeAlso: ['bindings', 'review-a-workflow', 'configuration'],
};

const reviewAWorkflow: WikiTopic = {
  id: 'review-a-workflow',
  title: 'Review, edit and approve',
  summary: 'What a revision is, and what approving one does and does not do.',
  blocks: [
    {
      kind: 'paragraph',
      text: 'A document holds an ordered history of revisions. A revision is immutable and checksummed: editing a step does not overwrite anything, it produces the next revision. That is what makes it possible to say later exactly what a run was compiled from.',
    },
    { kind: 'heading', text: 'On the review page' },
    {
      kind: 'list',
      items: [
        'Edit a step’s wording, insert a step, or reorder the sequence.',
        'Answer the clarifying questions a draft raised.',
        'Add the branches a recording could not take, and the outcomes each path reaches.',
        'See, per step, whether an Execution Binding exists and how far it got.',
      ],
    },
    { kind: 'heading', text: 'Outcomes are the workflow’s own' },
    {
      kind: 'paragraph',
      text: 'A workflow declares the business outcomes it can reach, on its own outcome steps. An outcome name is a lowercase identifier — a letter, then letters, digits or underscores, up to 64 characters. The single reserved name is none, which means a run reached no business conclusion. There is no fixed vocabulary to choose from.',
    },
    {
      kind: 'note',
      text: 'A business outcome and a run status are different facts. A run that correctly establishes that a record does not exist has succeeded technically and reached a not-found outcome. Neither answers the other.',
    },
    { kind: 'heading', text: 'What approval is not' },
    {
      kind: 'limitation',
      text: 'Approving a revision does not make anything runnable. The SOP Graph is non-executable by construction. Compiling and publishing are separate acts, and publishing is the only one that mints something a run can execute.',
    },
  ],
  seeAlso: ['bindings', 'publish-and-run'],
};

const bindings: WikiTopic = {
  id: 'bindings',
  title: 'Execution Bindings and the drift check',
  summary: 'How a step learns which element it acts on, and what happens when that element moves.',
  blocks: [
    {
      kind: 'paragraph',
      text: 'An approved step says "the field labelled Request number". An Execution Binding says which element that turned out to be: an ordered chain of locators, plus a fingerprint of the element as it looked when a person confirmed it.',
    },
    {
      kind: 'paragraph',
      text: 'Locators are a closed vocabulary — test id, role and accessible name, label. CSS and XPath cannot be expressed, so a binding cannot carry an arbitrary DOM-walking expression. A chain gives the runtime a fallback when a page drops one attribute.',
    },
    { kind: 'heading', text: 'The check before every action' },
    {
      kind: 'code',
      lines: [
        'approved binding -> describe the live element -> compare',
        '                                                   |',
        '                            matches --------------- act',
        '                            differs --------------- stop, capture evidence',
      ],
    },
    {
      kind: 'paragraph',
      text: 'The comparison is deterministic and consults no model, and it fails safe. On a mismatch the run stops, captures a screenshot and a DOM snapshot, and reports what changed. The executor is never asked to find a substitute element, because choosing a different element than the one a person approved is the decision no automated part of Orbit may make.',
    },
    { kind: 'heading', text: 'Getting a step bound' },
    {
      kind: 'steps',
      items: [
        'A recorded workflow arrives already bound: the steps and their bindings were captured from the same interaction.',
        'A drafted workflow is bound step by step, from the review page, in a sitting that holds one browser open.',
        'Either way a person demonstrates the step for real, and Orbit shows what it captured before saving it.',
      ],
    },
    {
      kind: 'note',
      text: 'Status and staleness are separate. An approved binding whose step has since been edited is still approved and still not safe to run; the panel says so by comparing the binding against the step as it now reads.',
    },
    {
      kind: 'limitation',
      text: 'A manual-review step is listed but cannot be bound. It routes to a person, so there is nothing to automate. A capture with no candidate that uniquely resolves to the right element is refused rather than saved.',
    },
  ],
  seeAlso: ['drift-recovery', 'publish-and-run', 'review-a-workflow'],
};

const publishAndRun: WikiTopic = {
  id: 'publish-and-run',
  title: 'Publish and run an agent',
  summary: 'How a reviewed workflow becomes an immutable version, and how you trigger it.',
  blocks: [
    {
      kind: 'steps',
      items: [
        'Compile the approved revision into a candidate Agent IR. Anything not fully understood is refused rather than guessed at.',
        'Approve the candidate.',
        'Publish. That mints a new immutable Agent Version and allocates its number.',
        'Open the agent, fill in its declared inputs, and start a run.',
      ],
    },
    {
      kind: 'paragraph',
      text: 'A recorded workflow can take all of that in one Publish action from its review page; the result is checked to be equivalent to what the step-by-step path produces.',
    },
    { kind: 'heading', text: 'What publishing does' },
    {
      kind: 'paragraph',
      text: 'Publishing mints a version rather than promoting the candidate. The runtime executes only published documents and the compiler emits drafts, so the two can never be byte-identical — and that difference is the approval gate. Exactly two fields differ, and a check verifies that against what was actually stored, so a widened permission or an added step cannot ride along.',
    },
    {
      kind: 'paragraph',
      text: 'A version is immutable once minted. Archiving an agent retires its identity; it never deletes or edits a version. Every run references the exact version it executed.',
    },
    { kind: 'heading', text: 'What an agent is allowed to open' },
    {
      kind: 'paragraph',
      text: 'Each Agent Version declares the domains it may navigate to. The validator checks that list when the version is published, and the runtime re-checks it before every navigation. An agent may open the hosts its recording visited and nothing else.',
    },
    {
      kind: 'limitation',
      text: 'Runs execute inside the API process. There is no queue, worker fleet or scheduler. There is no server-side duplicate suppression — two tabs can start two runs, and the API will create two. A started run cannot be cancelled; it runs to completion. There is no authentication: every request is the fixed development actor, and any caller who can reach the API can read any run and its evidence.',
    },
    { kind: 'heading', text: 'From a terminal instead' },
    { kind: 'code', lines: ['pnpm agent:run -- --help'] },
  ],
  seeAlso: ['evidence', 'drift-recovery', 'configuration'],
};

const evidence: WikiTopic = {
  id: 'evidence',
  title: 'Read a run’s evidence',
  summary: 'What every run records, and how to reconstruct what happened.',
  blocks: [
    {
      kind: 'paragraph',
      text: 'Evidence is a product feature, not debug output. Every run persists enough to reconstruct the execution from stored data alone, without re-running anything.',
    },
    {
      kind: 'table',
      columns: ['Recorded', 'What it tells you'],
      rows: [
        ['The exact Agent Version id', 'Precisely which immutable workflow executed'],
        ['Validated input values', 'What it was asked to do'],
        ['Run and step status transitions', 'Where it got to, and in what order'],
        ['Structured events', 'Navigation, fill, click, extract, assertion results'],
        ['Screenshots', 'After navigation, fill, click, and the final state'],
        ['DOM snapshots', 'After navigation and after a state-changing click'],
        ['A Playwright trace', 'Every run, always'],
        ['Extracted values', 'What a successful lookup actually read off the page'],
        ['Typed error data', 'For a failure, what kind of failure it was'],
      ],
    },
    { kind: 'heading', text: 'Reading a run' },
    {
      kind: 'steps',
      items: [
        'Open Runs and pick the run, or follow the link from the agent you started.',
        'Read the timeline: one sequence of steps with their events and artifacts in place.',
        'Open an artifact to see the screenshot, DOM snapshot or trace it points at.',
      ],
    },
    {
      kind: 'note',
      text: 'Artifact bytes live on the filesystem under the configured artifact directory; the metadata and links live in PostgreSQL. Nothing binary is stored in the database.',
    },
    {
      kind: 'limitation',
      text: 'Evidence is unauthenticated in this build, exactly like the rest of the API. Treat a deployment as readable by anyone who can reach it.',
    },
  ],
  seeAlso: ['publish-and-run', 'troubleshooting'],
};

const driftRecovery: WikiTopic = {
  id: 'drift-recovery',
  title: 'When a run stops because the page changed',
  summary: 'What UI-drift recovery does — and, just as importantly, what it never does.',
  blocks: [
    {
      kind: 'paragraph',
      text: 'A page changes and a step’s element no longer matches the fingerprint a person approved. The run stops. Recovery is what happens next, and it is narrower than it sounds.',
    },
    { kind: 'heading', text: 'The rules, exactly' },
    {
      kind: 'list',
      items: [
        'A drifted run fails. Recovery never resumes or rescues it.',
        'Recovery suggests a repair only from the approved binding’s existing fallback locator chain.',
        'It never scans the page for unapproved lookalikes.',
        'A proposal is a separate record from a binding.',
        'A human accepts it through the normal create, review, approve process.',
        'Acceptance does not publish. A person must publish before later runs use the change.',
        'Recovery is deterministic and uses no LLM or model of any kind.',
        'Recovery is permission-gated per document, through the document’s recovery grant.',
      ],
    },
    {
      kind: 'paragraph',
      text: 'The question a diagnosis asks is deliberately narrow: of the locators a person already demonstrated for this element, does exactly one still find the element they approved? If more than one does, or none does, it refuses — because choosing between plausible replacements is judgement, and judgement here would be a guess wearing a confidence score.',
    },
    { kind: 'heading', text: 'Answering a proposal' },
    {
      kind: 'steps',
      items: [
        'Open the workflow in Studio. Open proposals appear beside the step they concern.',
        'Read what it says changed: the locator before, the locator after, and the element identity behind the claim.',
        'Accept, and a binding is created through the ordinary lifecycle — or Dismiss, which closes the proposal and changes nothing else.',
        'Publish a new version yourself. Until you do, no run uses the repair.',
      ],
    },
    {
      kind: 'note',
      text: 'A stale proposal is withdrawn rather than adjusted to fit. If the step was re-recorded or edited underneath it, accepting is refused.',
    },
    { kind: 'heading', text: 'Turning it on' },
    {
      kind: 'paragraph',
      text: 'The grant is per document, and it is off unless granted. Withdrawing it stops future versions declaring the capability; it cannot retract it from versions already published, because those are immutable and a version that no longer said what it does would be worse than the grant.',
    },
    {
      kind: 'limitation',
      text: 'There is no UI control for the grant in this build. It is set over the API: POST /v1/sop-documents/{documentId}/recovery with a JSON body of {"enabled": true}. Accepting and dismissing proposals, by contrast, are both in Studio.',
    },
  ],
  seeAlso: ['bindings', 'evidence', 'troubleshooting'],
};

const configuration: WikiTopic = {
  id: 'configuration',
  title: 'Ports, environment and model providers',
  summary: 'What runs where, and which settings are deployment configuration.',
  blocks: [
    { kind: 'heading', text: 'Local services' },
    {
      kind: 'table',
      columns: ['Address', 'Service'],
      rows: [
        ['http://localhost:3000', 'Watchtower — this application'],
        ['http://localhost:3002', 'The API'],
        ['http://localhost:3001/requests', 'The demo service-request portal'],
        ['http://localhost:3020', 'The demo library portal'],
        ['localhost:5432', 'PostgreSQL'],
      ],
    },
    {
      kind: 'note',
      text: 'Ports 3010 and 3102 are reserved for the end-to-end test stack. No application may bind them, so a test run never collides with a development session.',
    },
    { kind: 'heading', text: 'Settings are deployment configuration' },
    {
      kind: 'paragraph',
      text: 'The model provider, the model, and every token ceiling are read once when the process starts. None of them is editable from this application, and that is a decision rather than a gap: a cap a client could raise for itself is not a cap. The Admin tab displays what is in force — the model family and invocation, the artifact root, the API address, the migration level — and what has been spent against the ceilings; Home shows the spend too. Neither can change any of it.',
    },
    {
      kind: 'paragraph',
      text: 'Everything configurable is an environment variable, documented with its default in the repository’s .env.example and in the README’s configuration section. The health of the API is at /health.',
    },
    {
      kind: 'limitation',
      text: 'There is no authentication, no user account and no per-user preference anywhere in this build. The only notion of an actor is a fixed development identity.',
    },
  ],
  seeAlso: ['troubleshooting', 'publish-and-run'],
};

const troubleshooting: WikiTopic = {
  id: 'troubleshooting',
  title: 'Troubleshooting',
  summary: 'The failures that actually happen, and what each one means.',
  blocks: [
    { kind: 'heading', text: 'A run stopped and mentions drift' },
    {
      kind: 'paragraph',
      text: 'The element a step was bound to no longer matches what was approved. That is the drift check working. Read the captured screenshot and DOM snapshot to see what the page looks like now, then either re-record the step or answer the recovery proposal if the document has recovery granted.',
    },
    { kind: 'heading', text: 'A workflow will not compile' },
    {
      kind: 'paragraph',
      text: 'The compiler refuses everything it does not fully understand rather than guessing. The refusal names what it could not resolve — commonly an unbound step, a stale binding whose step was edited after it was recorded, or a path that reaches no outcome.',
    },
    { kind: 'heading', text: 'An agent will not navigate somewhere' },
    {
      kind: 'paragraph',
      text: 'Each Agent Version declares the domains it may open, and the runtime re-checks that before every navigation. A host that was not in the recording is not in the list. Publish a new version from a recording that visits it.',
    },
    { kind: 'heading', text: 'Nothing appears on Agents after publishing' },
    {
      kind: 'paragraph',
      text: 'The catalog is re-read each time Agents becomes the active view. Navigate to it again rather than reloading. If it is still missing, the publish did not complete — the review page reports that.',
    },
    { kind: 'heading', text: 'A recording opened no browser window' },
    {
      kind: 'paragraph',
      text: 'The window opens on the machine running the API, not on the machine running your browser. Against a remote API there is nothing to see locally.',
    },
    { kind: 'heading', text: 'Drafting was refused' },
    {
      kind: 'paragraph',
      text: 'Either no model provider is configured for this deployment, or a token ceiling was reached. Both are deployment configuration; neither can be changed from here.',
    },
    { kind: 'heading', text: 'The page shows an API error' },
    {
      kind: 'paragraph',
      text: 'Watchtower talks to the API over /v1 and shows the failure rather than hiding it. Check that the API process is running and answering at /health.',
    },
    {
      kind: 'note',
      text: 'Setup and database problems — a server that will not connect, a role that is missing, a test-database guard that fired — are covered in the repository README’s troubleshooting section, because fixing them happens in a terminal rather than here.',
    },
  ],
  seeAlso: ['drift-recovery', 'bindings', 'configuration'],
};

/** Ordered as a reader meets them: what it is, then making one, then running it, then when it breaks. */
export const WIKI_TOPICS: readonly WikiTopic[] = [
  gettingStarted,
  recordAWorkflow,
  describeAWorkflow,
  reviewAWorkflow,
  bindings,
  publishAndRun,
  evidence,
  driftRecovery,
  configuration,
  troubleshooting,
];

/** The topic a `?topic=` parameter names, or null when it names nothing. */
export function wikiTopicById(id: string | undefined): WikiTopic | null {
  if (id === undefined) {
    return null;
  }

  return WIKI_TOPICS.find((topic) => topic.id === id) ?? null;
}
