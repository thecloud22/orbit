import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';

import { sopDocumentIdSchema, type SopDocumentId } from '@orbit/contracts';
import {
  createDatabase,
  createRepositories,
  requireDatabaseUrl,
  type OrbitDatabase,
  type SopGraphRevisionRecord,
} from '@orbit/db';
import {
  adviseOnCoverage,
  adviseOnSelectors,
  adviseOnSemanticMatch,
  createAnthropicAssistProvider,
  createUnconfiguredAssistProvider,
  type Advice,
  type AssistProvider,
} from '@orbit/execution-assist';
import type { BindingBody } from '@orbit/execution-mapping';
import {
  openRecordingSession,
  type CapturedAction,
  type RecordingSession,
} from '@orbit/execution-recorder';
import { describeStep, type SopGraph, type SopStep } from '@orbit/sop-graph';
import {
  bindingBodyFor,
  boundStepIds,
  createBinding,
  type BindingChoice,
} from '@orbit/sop-service';

import { buildConfirmSummary, summarizeValueSource } from '../confirm';
import {
  captureModeForStep,
  declaredNames,
  decideStartUrl,
  readMethodFor,
  READ_METHODS,
  resolveValueSource,
  stepChoices,
  suggestedStartUrl,
  type ValueSourceChoice,
} from '../flow';
import { loadRootEnv } from './env';

/**
 * `pnpm record:binding -- --document sopdoc_…`
 *
 * A person demonstrates each step of a workflow once, against a sandbox, and
 * this records what they did as an Execution Binding.
 *
 * A terminal rather than a web page, deliberately. The human already has two
 * windows open — the browser they are clicking in, and the shell they started
 * this from — and a third to confirm in would be one more than the job needs.
 * The trade-off is real and recorded in ADR-019: bindings are confirmed here
 * while SOP graphs are reviewed in Watchtower.
 *
 * Everything it does in the browser is real. That is the point, and it is why
 * it refuses to open anything but a local sandbox.
 */

type Prompt = ReturnType<typeof createInterface>;

/**
 * Asks a question, treating end-of-input as "nothing more to say".
 *
 * Closing stdin — Ctrl-D, or a script piping a fixed set of answers — makes
 * `readline` throw on the next question. That is a normal way to end a session,
 * not a crash, so it answers with a blank line, and every caller already knows
 * what a blank line means.
 */
async function ask(io: Prompt, question: string): Promise<string> {
  try {
    return await io.question(question);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ERR_USE_AFTER_CLOSE') {
      return '';
    }
    throw error;
  }
}

const USAGE = `
Usage: pnpm record:binding -- --document <sopdoc_id> [options]

  --document <id>     Required. The SOP document to record bindings for.
  --start-url <url>   Where to open the browser. Localhost only.
  --headless          For debugging only; you cannot demonstrate what you cannot see.
  --help              Show this message.
`;

interface Context {
  readonly io: Prompt;
  readonly database: OrbitDatabase;
  readonly documentId: SopDocumentId;
  readonly revision: SopGraphRevisionRecord;
  readonly graph: SopGraph;
  readonly assist: AssistProvider;
}

// `pnpm record:binding -- --flag` forwards the `--` separator itself, which
// parseArgs would read as "everything after this is positional". Dropping a
// leading one lets both that and a direct `tsx ... --flag` work — the same
// handling `apps/browser-worker/src/cli/run-agent.ts` already needed.
const argv = process.argv.slice(2);
const args = argv[0] === '--' ? argv.slice(1) : argv;

async function main(): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      document: { type: 'string' },
      'start-url': { type: 'string' },
      headless: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });

  if (values.help === true || values.document === undefined) {
    process.stdout.write(USAGE);
    process.exit(values.help === true ? 0 : 1);
  }

  loadRootEnv();

  const documentId = sopDocumentIdSchema.parse(values.document);
  const handle = createDatabase({ url: requireDatabaseUrl('DATABASE_URL') });
  const io = createInterface({ input: process.stdin, output: process.stdout });

  try {
    const repositories = createRepositories(handle.db);
    const document = await repositories.sopDocuments.findById(documentId);
    const revision = await repositories.sopGraphRevisions.findCurrent(documentId);

    if (document === null || revision === null) {
      throw new Error(`No SOP document "${documentId}" with a current revision.`);
    }

    const context: Context = {
      io,
      database: handle.db,
      documentId,
      revision,
      graph: revision.graph,
      assist: assistProvider(),
    };

    process.stdout.write(`\n${document.title} — revision ${revision.revisionNumber}\n`);

    // One browser for the whole sitting. Mapping a workflow means recording
    // several steps in sequence, and each starts wherever the last left the
    // page — reopening a blank page every time would put anything past a
    // sign-in out of reach.
    let session: RecordingSession | undefined;

    try {
      for (;;) {
        const choices = stepChoices(context.graph, await boundStepIds(handle.db, documentId));

        printSteps(choices);
        printCoverage(choices);

        const picked = await pickStep(io, choices);

        if (picked === undefined) {
          return;
        }

        if (session === undefined) {
          const startUrl = await askStartUrl(io, picked.step, values['start-url']);

          if (startUrl === undefined) {
            return;
          }

          process.stdout.write('\nOpening the browser. Work in it, then come back here.\n');
          session = await openRecordingSession({
            startUrl,
            mode: captureModeForStep(picked.step),
            headless: values.headless === true,
          });
        } else {
          // Switching modes leaves the page exactly where it is, which is the
          // whole point of not reloading to do it.
          await session.setMode(captureModeForStep(picked.step));
          process.stdout.write(`\nStill at ${session.currentUrl()}\n`);
        }

        session.clearCaptures();
        await recordStep(context, session, picked.step);

        if ((await ask(io, '\nRecord another step? [Y/n] ')).trim().toLowerCase() === 'n') {
          return;
        }
      }
    } finally {
      await session?.close();
    }
  } finally {
    io.close();
    await handle.close();
  }
}

/** Captures, confirms and saves one step. */
async function recordStep(
  context: Context,
  session: RecordingSession,
  step: SopStep,
): Promise<void> {
  const mode = captureModeForStep(step);
  const capture = await waitForCapture(context.io, session, mode);

  if (capture === undefined) {
    return;
  }

  const body = await buildBody(context, step, capture);

  if (body === undefined) {
    return;
  }

  const advice = await gatherAdvice(context.assist, step, capture);

  const summary = buildConfirmSummary({
    step,
    capture,
    valueSourceSummary:
      body.kind === 'fill' ? summarizeValueSource(body.valueSource, capture.typedValue) : undefined,
    readMethodSummary: 'readMethod' in body ? body.readMethod.kind : undefined,
    advice,
  });

  process.stdout.write(`\n${'-'.repeat(68)}\n${summary.lines.join('\n')}\n${'-'.repeat(68)}\n`);

  if ((await ask(context.io, '\nSave this binding? [y/N] ')).trim().toLowerCase() !== 'y') {
    process.stdout.write('Discarded. Nothing was saved.\n');
    return;
  }

  const repositories = createRepositories(context.database);
  const existing = await repositories.executionBindings.findCurrent(context.documentId, step.id);

  const result = await createBinding({
    database: context.database,
    documentId: context.documentId,
    revisionId: context.revision.id,
    graph: context.graph,
    step,
    body,
    ...(existing === null ? {} : { parentBindingId: existing.id }),
  });

  if (!result.ok) {
    process.stdout.write(
      result.reason === 'not_bindable'
        ? '\nThat step cannot be recorded: it routes to a person.\n'
        : `\nThat binding was refused:\n${result.issues
            .map((issue) => `  [${issue.code}] ${issue.message}`)
            .join('\n')}\n`,
    );
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`\nSaved as ${result.binding.id} (${result.binding.state}).\n`);

  if ((await ask(context.io, 'Submit it for review now? [y/N] ')).trim().toLowerCase() === 'y') {
    const reviewed = await repositories.executionBindings.submitForReview(result.binding.id);
    process.stdout.write(`Now ${reviewed.state}.\n`);
  }
}

/** A model is optional: without one there is no advice, and recording is unaffected. */
function assistProvider(): AssistProvider {
  const apiKey = process.env['ANTHROPIC_API_KEY'];

  return apiKey === undefined || apiKey.trim() === ''
    ? createUnconfiguredAssistProvider(
        'ANTHROPIC_API_KEY is not set, so suggestions are unavailable.',
      )
    : createAnthropicAssistProvider({ apiKey });
}

async function gatherAdvice(
  provider: AssistProvider,
  step: SopStep,
  capture: CapturedAction,
): Promise<readonly Advice[]> {
  return [
    ...adviseOnSelectors(capture.selectors),
    ...(await adviseOnSemanticMatch(provider, {
      stepPurpose: describeStep(step),
      stepKind: step.kind,
      fingerprint: capture.fingerprint,
      selectors: capture.selectors,
    })),
  ];
}

function printSteps(choices: ReturnType<typeof stepChoices>): void {
  process.stdout.write('\n');
  choices.forEach((choice, index) => {
    const marker = choice.hasBinding ? 'bound' : choice.bindable ? '     ' : ' n/a ';
    process.stdout.write(`  ${String(index + 1).padStart(2)}. [${marker}] ${choice.label}\n`);
    if (!choice.bindable) {
      process.stdout.write(`          ${choice.reason ?? ''}\n`);
    }
  });
}

function printCoverage(choices: ReturnType<typeof stepChoices>): void {
  for (const advice of adviseOnCoverage(
    choices.map((choice) => ({
      stepId: choice.step.id,
      label: choice.label,
      bindable: choice.bindable,
      hasBinding: choice.hasBinding,
    })),
  )) {
    process.stdout.write(`\n  ${advice.message}\n`);
  }
}

async function pickStep(
  io: Prompt,
  choices: ReturnType<typeof stepChoices>,
): Promise<ReturnType<typeof stepChoices>[number] | undefined> {
  for (;;) {
    const answer = (await ask(io, '\nWhich step? (number, or blank to finish) ')).trim();

    if (answer === '') {
      return undefined;
    }

    const choice = choices[Number.parseInt(answer, 10) - 1];

    if (choice === undefined) {
      process.stdout.write('  No step with that number.\n');
      continue;
    }

    if (!choice.bindable) {
      // Refused clearly rather than obscurely. The schema could not express
      // this binding either, but a schema error is not an answer.
      process.stdout.write(`  ${choice.reason ?? 'That step cannot be recorded.'}\n`);
      continue;
    }

    return choice;
  }
}

async function askStartUrl(
  io: Prompt,
  step: SopStep,
  fromFlag: string | undefined,
): Promise<string | undefined> {
  const suggested = fromFlag ?? suggestedStartUrl(step) ?? 'http://localhost:3001/requests';

  for (;;) {
    const answer = (
      await ask(io, `\nStart at [${suggested}] (blank to accept, q to quit) `)
    ).trim();

    if (answer === 'q') {
      return undefined;
    }

    const decision = decideStartUrl(answer === '' ? suggested : answer);

    if (decision.ok) {
      return decision.url;
    }

    process.stdout.write(`  ${decision.reason}\n`);
  }
}

async function waitForCapture(
  io: Prompt,
  session: RecordingSession,
  mode: 'action' | 'pick',
): Promise<CapturedAction | undefined> {
  process.stdout.write(
    mode === 'action'
      ? '\nPerform the step in the browser, then press Enter here.\n'
      : '\nClick the value to read in the browser — the page will not react — then press Enter here.\n',
  );

  for (;;) {
    await ask(io, '');

    for (const failure of session.failures()) {
      process.stdout.write(`\n  ${failure.reason}\n`);
    }

    const captures = session.captures();

    if (captures.length === 0) {
      if (
        (await ask(io, '  Nothing was captured. Try again? [Y/n] ')).trim().toLowerCase() === 'n'
      ) {
        return undefined;
      }
      continue;
    }

    if (captures.length === 1) {
      return captures[0];
    }

    // More than one action reached the page. Which one mattered is the human's
    // call, not a last-one-wins guess.
    process.stdout.write('\n  More than one action was captured:\n');
    captures.forEach((entry, index) => {
      process.stdout.write(
        `    ${index + 1}. ${entry.type} — ${entry.fingerprint.accessibleName ?? entry.fingerprint.text ?? '(unnamed)'}\n`,
      );
    });

    const chosen =
      captures[Number.parseInt((await ask(io, '  Which one is the step? ')).trim(), 10) - 1];

    if (chosen !== undefined) {
      return chosen;
    }

    process.stdout.write('  No capture with that number.\n');
  }
}

async function buildBody(
  context: Context,
  step: SopStep,
  capture: CapturedAction,
): Promise<BindingBody | undefined> {
  const choice = await askChoice(context, step, capture);

  if (choice === undefined) {
    return undefined;
  }

  // Assembled by @orbit/sop-service, not here: the terminal and Watchtower's
  // binding sessions must produce the same body from the same answers
  // (ADR-027), so this file asks the questions and nothing more.
  const result = bindingBodyFor({
    step,
    capture: {
      selectors: capture.selectors,
      fingerprint: capture.fingerprint,
      url: capture.url,
      ...(capture.typedValue === undefined ? {} : { typedValue: capture.typedValue }),
    },
    choice,
  });

  if (!result.ok) {
    process.stdout.write(`  ${result.reason}\n`);
    return undefined;
  }

  return result.body;
}

/** The one judgement a capture cannot supply, asked per step kind. */
async function askChoice(
  context: Context,
  step: SopStep,
  capture: CapturedAction,
): Promise<BindingChoice | undefined> {
  if (step.kind === 'click') {
    return { kind: 'click' };
  }

  if (step.kind === 'navigate') {
    return { kind: 'navigate' };
  }

  if (step.kind === 'fill') {
    const names = declaredNames(context.graph);

    process.stdout.write('\n  Values this workflow declares:\n');
    names.forEach((name, index) => process.stdout.write(`    ${index + 1}. ${name}\n`));

    if (capture.typedValue !== undefined) {
      process.stdout.write(`\n  You typed "${capture.typedValue}" to check the field.\n`);
      process.stdout.write('  That is discarded unless you keep it as a fixed default.\n');
    }

    const answer = (
      await ask(context.io, '\n  Value source — a number, or "keep" to use what you typed: ')
    ).trim();

    let choice: ValueSourceChoice;

    if (answer.toLowerCase() === 'keep') {
      choice = { kind: 'keep_typed_value' };
    } else {
      const name = names[Number.parseInt(answer, 10) - 1];

      if (name === undefined) {
        process.stdout.write('  No value with that number.\n');
        return undefined;
      }

      choice = { kind: 'variable', name };
    }

    return { kind: 'fill', valueSource: resolveValueSource(choice, capture.typedValue) };
  }

  const answered = (
    await ask(context.io, `\n  How is it read? [${READ_METHODS.join('/')}] `)
  ).trim() as (typeof READ_METHODS)[number];

  const method = READ_METHODS.includes(answered) ? answered : 'text';
  const attribute =
    method === 'attribute' ? (await ask(context.io, '  Which attribute? ')).trim() : undefined;
  const readMethod = readMethodFor(method, attribute);

  if (step.kind === 'decision') {
    // A decision binds one element *per branch*, and this CLI's flow is
    // one-capture-one-binding. Refused rather than half-bound: Watchtower's
    // binding panel walks the branches in turn and is the way to bind one.
    process.stdout.write(
      '  A decision needs one element per branch, which this recorder cannot assemble.\n' +
        '  Bind it from the review page in Watchtower instead.\n',
    );
    return undefined;
  }

  const variable = (await ask(context.io, '  Which workflow value does it populate? ')).trim();

  return step.kind === 'outcome'
    ? { kind: 'outcome', readMethod, variable }
    : { kind: 'extract', readMethod, variable };
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
}
