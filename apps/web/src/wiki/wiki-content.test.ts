import { describe, expect, it } from 'vitest';

import { WIKI_TOPICS, wikiTopicById } from './wiki-content';

describe('wiki topics', () => {
  it('gives every topic a unique id, since the id is the URL', () => {
    const ids = WIKI_TOPICS.map((topic) => topic.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses ids that survive a URL unchanged', () => {
    // A topic id goes into `?topic=` verbatim. Anything needing escaping would
    // make the link in the address bar differ from the one in the source.
    for (const topic of WIKI_TOPICS) {
      expect(topic.id).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  it('gives every topic a title, a summary and something to read', () => {
    for (const topic of WIKI_TOPICS) {
      expect(topic.title.length).toBeGreaterThan(0);
      expect(topic.summary.length).toBeGreaterThan(0);
      expect(topic.blocks.length).toBeGreaterThan(0);
    }
  });

  it('leaves no block empty', () => {
    for (const topic of WIKI_TOPICS) {
      for (const block of topic.blocks) {
        switch (block.kind) {
          case 'steps':
          case 'list':
            expect(block.items.length).toBeGreaterThan(0);
            break;
          case 'code':
            expect(block.lines.length).toBeGreaterThan(0);
            break;
          case 'table':
            expect(block.rows.length).toBeGreaterThan(0);
            break;
          default:
            expect(block.text.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('resolves every cross-reference, and never to itself', () => {
    for (const topic of WIKI_TOPICS) {
      for (const id of topic.seeAlso ?? []) {
        expect(id).not.toBe(topic.id);
        expect(wikiTopicById(id)).not.toBeNull();
      }
    }
  });

  it('finds a topic by id and refuses anything else', () => {
    expect(wikiTopicById('drift-recovery')?.id).toBe('drift-recovery');
    expect(wikiTopicById('no-such-topic')).toBeNull();
    expect(wikiTopicById(undefined)).toBeNull();
  });
});

describe('the drift-recovery topic', () => {
  /**
   * This is a regression test against a *documentation* failure, which is why
   * it is unusually literal.
   *
   * Every clause below is a bound on what recovery may do, and each one is the
   * kind of thing a later edit softens by accident while making the page read
   * more smoothly — "recovery repairs a drifted run" instead of "a drifted run
   * fails", say. The eight statements have to survive rewording as statements,
   * so the assertion is on the claim rather than on the prose.
   */
  const topic = wikiTopicById('drift-recovery');

  const claims = (): string =>
    (topic?.blocks ?? [])
      .flatMap((block) => {
        switch (block.kind) {
          case 'steps':
          case 'list':
            return block.items;
          case 'code':
            return block.lines;
          case 'table':
            return block.rows.flatMap((row) => [row[0], row[1]]);
          default:
            return [block.text];
        }
      })
      .join(' ')
      .toLowerCase();

  it('exists', () => {
    expect(topic).not.toBeNull();
  });

  it('says a drifted run fails and is never resumed', () => {
    expect(claims()).toContain('a drifted run fails');
    expect(claims()).toContain('never resumes or rescues it');
  });

  it('says a repair comes only from the approved fallback chain', () => {
    expect(claims()).toContain('only from the approved binding’s existing fallback locator chain');
  });

  it('says the page is never scanned for lookalikes', () => {
    expect(claims()).toContain('never scans the page for unapproved lookalikes');
  });

  it('says a proposal is a separate record from a binding', () => {
    expect(claims()).toContain('a separate record from a binding');
  });

  it('says a human accepts through the normal review process', () => {
    expect(claims()).toContain('create, review, approve');
  });

  it('says acceptance does not publish', () => {
    expect(claims()).toContain('acceptance does not publish');
    expect(claims()).toContain('must publish before later runs use the change');
  });

  it('says recovery uses no model', () => {
    expect(claims()).toContain('deterministic and uses no llm or model');
  });

  it('says the grant is per document', () => {
    expect(claims()).toContain('permission-gated per document');
  });

  it('does not promise a UI control the build does not have', () => {
    // The grant endpoint has no Watchtower control. Saying otherwise sends a
    // reader looking for a switch that is not there.
    expect(claims()).toContain('no ui control for the grant');
  });
});
