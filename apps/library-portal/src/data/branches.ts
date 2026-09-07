export interface BranchHours {
  readonly weekdays: string;
  readonly friday: string;
  readonly saturday: string;
  readonly sunday: string;
}

export interface Branch {
  readonly id: string;
  readonly name: string;
  readonly address: string;
  readonly phone: string;
  readonly hours: BranchHours;
}

/**
 * Static branch directory for the Hours & Locations page.
 *
 * Fictional township, fictional addresses (555 phone numbers, ST/00000
 * placeholders) — purely decorative content for a realistic site shell.
 */
export const BRANCHES: readonly Branch[] = Object.freeze([
  Object.freeze({
    id: 'main',
    name: 'Main Branch',
    address: '100 Civic Center Drive, Fairview, ST 00000',
    phone: '(555) 013-0142',
    hours: Object.freeze({
      weekdays: '9:00 AM – 8:00 PM',
      friday: '9:00 AM – 5:00 PM',
      saturday: '9:00 AM – 5:00 PM',
      sunday: 'Closed',
    }),
  }),
  Object.freeze({
    id: 'northside',
    name: 'Northside Branch',
    address: '42 Ridgeline Avenue, Fairview, ST 00001',
    phone: '(555) 013-0198',
    hours: Object.freeze({
      weekdays: '10:00 AM – 7:00 PM',
      friday: '10:00 AM – 5:00 PM',
      saturday: '10:00 AM – 4:00 PM',
      sunday: 'Closed',
    }),
  }),
  Object.freeze({
    id: 'eastside',
    name: 'Eastside Branch',
    address: '918 Harbor Road, Fairview, ST 00002',
    phone: '(555) 013-0176',
    hours: Object.freeze({
      weekdays: '10:00 AM – 6:00 PM',
      friday: '10:00 AM – 6:00 PM',
      saturday: '9:00 AM – 1:00 PM',
      sunday: 'Closed',
    }),
  }),
]) as readonly Branch[];
