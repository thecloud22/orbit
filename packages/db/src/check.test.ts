import { describe, expect, it } from 'vitest';

import {
  isMigrationLevelCurrent,
  migrationLevel,
  readMigrationJournal,
  type MigrationJournalEntry,
} from './check';

const journal: readonly MigrationJournalEntry[] = [
  { idx: 0, when: 100, tag: '0000_first' },
  { idx: 1, when: 200, tag: '0001_second' },
  { idx: 2, when: 300, tag: '0002_third' },
];

describe('migrationLevel', () => {
  it('reports every committed migration as pending on a fresh database', () => {
    const level = migrationLevel(journal, []);

    expect(level.committed).toEqual(['0000_first', '0001_second', '0002_third']);
    expect(level.applied).toEqual([]);
    expect(level.pending).toEqual(['0000_first', '0001_second', '0002_third']);
    expect(level.unrecognised).toBe(0);
    expect(isMigrationLevelCurrent(level)).toBe(false);
  });

  it('splits applied from pending on a partly migrated database', () => {
    const level = migrationLevel(journal, [100, 200]);

    expect(level.applied).toEqual(['0000_first', '0001_second']);
    expect(level.pending).toEqual(['0002_third']);
    expect(isMigrationLevelCurrent(level)).toBe(false);
  });

  it('is current when every committed migration has been applied', () => {
    const level = migrationLevel(journal, [100, 200, 300]);

    expect(level.pending).toEqual([]);
    expect(level.unrecognised).toBe(0);
    expect(isMigrationLevelCurrent(level)).toBe(true);
  });

  it('counts applied rows the checkout does not know about', () => {
    // A database migrated by a newer checkout. No migration command fixes this,
    // so it must not be reported as "up to date".
    const level = migrationLevel(journal, [100, 200, 300, 400]);

    expect(level.pending).toEqual([]);
    expect(level.unrecognised).toBe(1);
    expect(isMigrationLevelCurrent(level)).toBe(false);
  });

  it('orders committed migrations by journal index, not by array order', () => {
    const shuffled = [journal[2], journal[0], journal[1]] as MigrationJournalEntry[];

    expect(migrationLevel(shuffled, []).committed).toEqual([
      '0000_first',
      '0001_second',
      '0002_third',
    ]);
  });
});

describe('readMigrationJournal', () => {
  it('reads the committed journal of this checkout', () => {
    const entries = readMigrationJournal();

    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]?.tag).toBe('0000_phase_1_evidence_schema');
    // Indices are contiguous from zero; a gap means a migration was deleted.
    expect(entries.map((entry) => entry.idx)).toEqual(entries.map((_, index) => index));
  });
});
