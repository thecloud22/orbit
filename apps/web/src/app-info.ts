export interface AppInfo {
  readonly title: string;
  readonly description: string;
}

export const APP_INFO: AppInfo = {
  title: 'Orbit Watchtower',
  description:
    'Start the Find Service Request agent and inspect the run it produced: status, outcome, steps, events, and the evidence recorded for each.',
};
