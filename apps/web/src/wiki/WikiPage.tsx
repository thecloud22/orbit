import { WIKI_TOPICS, wikiTopicById, type WikiBlock, type WikiTopic } from './wiki-content';
import type { View } from '../app/navigation';

export interface WikiPageProps {
  /** The topic named by the URL, if any. An unknown one falls back to the index. */
  readonly topic: string | undefined;
  readonly onNavigate: (view: View) => void;
}

/**
 * The handbook.
 *
 * An index of topics, or one topic, decided by the URL like every other view
 * here. An unknown `?topic=` renders the index rather than an error: a link
 * that has gone stale should land somewhere useful, and there is nothing to
 * recover from.
 */
export function WikiPage({ topic, onNavigate }: WikiPageProps) {
  const current = wikiTopicById(topic);

  return (
    <div className="flex flex-col gap-6" data-testid="wiki-page">
      {current === null ? (
        <WikiIndex onNavigate={onNavigate} />
      ) : (
        <WikiTopicView onNavigate={onNavigate} topic={current} />
      )}
    </div>
  );
}

function WikiIndex({ onNavigate }: { readonly onNavigate: (view: View) => void }) {
  return (
    <>
      <div>
        <h2 className="text-base font-semibold text-slate-900">Wiki</h2>
        <p className="mt-1 text-sm text-slate-600">
          How to record a workflow, bind its steps, publish it, run it, read the evidence, and
          answer a recovery proposal. Contracts and architecture live in the repository’s{' '}
          <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs">docs/</code>{' '}
          directory; this is the part you need while working.
        </p>
      </div>

      <ul className="grid gap-3 md:grid-cols-2" data-testid="wiki-index">
        {WIKI_TOPICS.map((entry) => (
          <li key={entry.id}>
            <a
              className="flex h-full flex-col rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-indigo-300"
              data-testid={`wiki-topic-link-${entry.id}`}
              href={`?view=wiki&topic=${encodeURIComponent(entry.id)}`}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) {
                  return;
                }

                event.preventDefault();
                onNavigate({ kind: 'wiki', topic: entry.id });
              }}
            >
              <h3 className="text-sm font-semibold text-slate-900">{entry.title}</h3>
              <p className="mt-1 text-sm text-slate-600">{entry.summary}</p>
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}

function WikiTopicView({
  topic,
  onNavigate,
}: {
  readonly topic: WikiTopic;
  readonly onNavigate: (view: View) => void;
}) {
  const related = (topic.seeAlso ?? [])
    .map((id) => wikiTopicById(id))
    .filter((entry): entry is WikiTopic => entry !== null);

  return (
    <>
      <button
        className="self-start text-sm text-slate-600 underline"
        data-testid="wiki-back"
        onClick={() => onNavigate({ kind: 'wiki' })}
        type="button"
      >
        ← All topics
      </button>

      <article className="flex flex-col gap-4" data-testid={`wiki-topic-${topic.id}`}>
        <div>
          <h2 className="text-base font-semibold text-slate-900" data-testid="wiki-topic-title">
            {topic.title}
          </h2>
          <p className="mt-1 text-sm text-slate-600">{topic.summary}</p>
        </div>

        {topic.blocks.map((block, index) => (
          // Blocks are static content in source order, never reordered or
          // filtered, so the index is a stable identity here.
          <Block block={block} key={index} />
        ))}

        {related.length === 0 ? null : (
          <section className="border-t border-slate-200 pt-4">
            <h3 className="text-sm font-semibold text-slate-900">Read next</h3>
            <ul className="mt-2 flex flex-wrap gap-2" data-testid="wiki-see-also">
              {related.map((entry) => (
                <li key={entry.id}>
                  <a
                    className="inline-block rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700 transition-colors hover:border-indigo-300 hover:text-indigo-700"
                    href={`?view=wiki&topic=${encodeURIComponent(entry.id)}`}
                    onClick={(event) => {
                      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) {
                        return;
                      }

                      event.preventDefault();
                      onNavigate({ kind: 'wiki', topic: entry.id });
                    }}
                  >
                    {entry.title}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
      </article>
    </>
  );
}

/** One block, rendered. Exhaustive over `WikiBlock`, so a new kind fails to compile. */
function Block({ block }: { readonly block: WikiBlock }) {
  switch (block.kind) {
    case 'heading':
      return <h3 className="mt-2 text-sm font-semibold text-slate-900">{block.text}</h3>;

    case 'paragraph':
      return <p className="text-sm leading-relaxed text-slate-700">{block.text}</p>;

    case 'steps':
      return (
        <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm leading-relaxed text-slate-700">
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      );

    case 'list':
      return (
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm leading-relaxed text-slate-700">
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      );

    case 'code':
      return (
        <pre className="overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-4 font-mono text-xs text-slate-800">
          {block.lines.join('\n')}
        </pre>
      );

    case 'table':
      return (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left">
                <th className="py-2 pr-4 font-semibold text-slate-900">{block.columns[0]}</th>
                <th className="py-2 font-semibold text-slate-900">{block.columns[1]}</th>
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row) => (
                <tr className="border-b border-slate-100 align-top" key={row[0]}>
                  <td className="py-2 pr-4 text-slate-700">{row[0]}</td>
                  <td className="py-2 text-slate-600">{row[1]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case 'note':
      return (
        <p className="rounded-lg border border-sky-200 bg-sky-50 p-4 text-sm leading-relaxed text-sky-900">
          {block.text}
        </p>
      );

    case 'limitation':
      return (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-relaxed text-amber-900">
          {block.text}
        </p>
      );
  }
}
