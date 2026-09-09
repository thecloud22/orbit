export interface AppInfo {
  readonly title: string;
  readonly description: string;
}

export const APP_INFO: AppInfo = {
  title: 'Fairview Township Public Library',
  description:
    'Controlled read-only demo portal for a township library site: catalog search, a staff ' +
    'circulation desk lookup, hours and locations, and events. An automation target, not a ' +
    'real library system.',
};
