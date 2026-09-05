export interface AppInfo {
  readonly title: string;
  readonly description: string;
}

export const APP_INFO: AppInfo = {
  title: 'Orbit Demo Portal',
  description:
    'Controlled read-only target application for Orbit Phase 1. Service request lookup lives at /requests.',
};
