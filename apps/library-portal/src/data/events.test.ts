import { describe, expect, it } from 'vitest';

import { EVENTS, searchEventsByDate } from './events';

describe('EVENTS', () => {
  it('seeds more than a handful of events', () => {
    expect(EVENTS.length).toBeGreaterThanOrEqual(10);
  });

  it('gives every event a calendar date', () => {
    for (const event of EVENTS) {
      expect(event.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('is frozen so the portal stays read-only', () => {
    expect(Object.isFrozen(EVENTS)).toBe(true);
    expect(Object.isFrozen(EVENTS[0])).toBe(true);
  });
});

describe('searchEventsByDate', () => {
  it('returns every event with a matching date, including more than one', () => {
    const results = searchEventsByDate('2026-09-17');

    expect(results.map((event) => event.title)).toEqual(
      expect.arrayContaining(['Book Club: Contemporary Fiction', 'Family Craft Hour']),
    );
  });

  it('returns an empty list for a date with no events', () => {
    expect(searchEventsByDate('2030-01-01')).toEqual([]);
  });

  it('returns every event for a blank date', () => {
    expect(searchEventsByDate('')).toEqual(EVENTS);
  });
});
