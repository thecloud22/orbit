export type EventCategory = 'Kids' | 'Teens' | 'Adults' | 'Community';

export interface LibraryEvent {
  readonly id: string;
  readonly title: string;
  /** A stored calendar date (YYYY-MM-DD), not derived from a clock. */
  readonly date: string;
  readonly time: string;
  readonly location: string;
  readonly category: EventCategory;
  readonly description: string;
}

/**
 * Static events list, searchable by date.
 *
 * Unlike the earlier "recurring cadence" design, these carry a concrete
 * date so a visitor can filter by it — but the date is still a stored fact
 * set at seed time, never computed from `Date.now()`, so the list itself
 * never goes stale on its own; only the calendar it refers to eventually
 * passes.
 */
export const EVENTS: readonly LibraryEvent[] = Object.freeze([
  Object.freeze({
    id: 'storytime-1',
    title: 'Toddler Storytime',
    date: '2026-09-08',
    time: '10:00 AM',
    location: 'Main Branch',
    category: 'Kids',
    description: 'Songs, rhymes, and picture books for children ages 1–3 and a caregiver.',
  }),
  Object.freeze({
    id: 'coding-club-1',
    title: 'Teen Coding Club',
    date: '2026-09-09',
    time: '4:00 PM',
    location: 'Northside Branch',
    category: 'Teens',
    description: 'Drop-in help session for teens working on programming projects.',
  }),
  Object.freeze({
    id: 'job-help-1',
    title: 'Job Search Help Desk',
    date: '2026-09-11',
    time: '1:00 PM',
    location: 'Eastside Branch',
    category: 'Adults',
    description: 'One-on-one help with resumes, job applications, and online accounts.',
  }),
  Object.freeze({
    id: 'storytime-2',
    title: 'Toddler Storytime',
    date: '2026-09-15',
    time: '10:00 AM',
    location: 'Main Branch',
    category: 'Kids',
    description: 'Songs, rhymes, and picture books for children ages 1–3 and a caregiver.',
  }),
  Object.freeze({
    id: 'book-club-1',
    title: 'Book Club: Contemporary Fiction',
    date: '2026-09-17',
    time: '6:30 PM',
    location: 'Main Branch',
    category: 'Adults',
    description: 'A different contemporary novel each month. New members welcome.',
  }),
  Object.freeze({
    id: 'craft-hour-1',
    title: 'Family Craft Hour',
    date: '2026-09-17',
    time: '11:00 AM',
    location: 'Eastside Branch',
    category: 'Kids',
    description: 'A different hands-on craft project each week, materials provided.',
  }),
  Object.freeze({
    id: 'job-help-2',
    title: 'Job Search Help Desk',
    date: '2026-09-18',
    time: '1:00 PM',
    location: 'Eastside Branch',
    category: 'Adults',
    description: 'One-on-one help with resumes, job applications, and online accounts.',
  }),
  Object.freeze({
    id: 'coding-club-2',
    title: 'Teen Coding Club',
    date: '2026-10-07',
    time: '4:00 PM',
    location: 'Northside Branch',
    category: 'Teens',
    description: 'Drop-in help session for teens working on programming projects.',
  }),
  Object.freeze({
    id: 'author-talk-1',
    title: 'Local Author Talk',
    date: '2026-10-09',
    time: '6:00 PM',
    location: 'Main Branch',
    category: 'Community',
    description: 'A Fairview Township author discusses their new book, followed by Q&A.',
  }),
  Object.freeze({
    id: 'storytime-3',
    title: 'Toddler Storytime',
    date: '2026-10-13',
    time: '10:00 AM',
    location: 'Main Branch',
    category: 'Kids',
    description: 'Songs, rhymes, and picture books for children ages 1–3 and a caregiver.',
  }),
  Object.freeze({
    id: 'trivia-night-1',
    title: 'Adult Trivia Night',
    date: '2026-10-16',
    time: '7:00 PM',
    location: 'Northside Branch',
    category: 'Adults',
    description: 'Team trivia across six rounds. Snacks provided, teams of up to six.',
  }),
  Object.freeze({
    id: 'book-club-2',
    title: 'Book Club: Contemporary Fiction',
    date: '2026-10-15',
    time: '6:30 PM',
    location: 'Main Branch',
    category: 'Adults',
    description: 'A different contemporary novel each month. New members welcome.',
  }),
  Object.freeze({
    id: 'friends-sale-1',
    title: 'Friends of the Library Book Sale',
    date: '2026-10-24',
    time: '9:00 AM',
    location: 'Main Branch',
    category: 'Community',
    description: 'Gently used books, donated by the community, sold to support the branches.',
  }),
]) as readonly LibraryEvent[];

/** Filters events to an exact calendar date; a blank date returns everything. */
export function searchEventsByDate(date: string): readonly LibraryEvent[] {
  const trimmed = date.trim();

  if (trimmed.length === 0) {
    return EVENTS;
  }

  return EVENTS.filter((event) => event.date === trimmed);
}
