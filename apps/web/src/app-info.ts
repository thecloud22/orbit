export interface AppInfo {
  readonly title: string;
  readonly description: string;
}

export const APP_INFO: AppInfo = {
  title: 'Orbit Watchtower',
  // Shown under the title in every view, not only Home — a one-line answer to
  // "what is this" that holds regardless of which agent or workflow is on
  // screen. The Home-specific "start this one agent and inspect its run"
  // sentence this replaced only ever described Phase 1's single seeded agent;
  // it kept describing that after Phase 2 made publishing more than one agent
  // possible, which is exactly the kind of stale copy that reads as confusing
  // rather than as branding.
  description: 'Turn how your business works into governed, executable agents.',
};
