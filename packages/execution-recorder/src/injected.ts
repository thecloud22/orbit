/**
 * The one script Orbit injects into a page, and it is deliberately tiny.
 *
 * This is the trust boundary sub-phase 2.4 was split to isolate: recording a
 * human's click needs a listener inside the page, which is a capability ADR-008
 * denies the runtime outright. Since it cannot be avoided, it is made as small
 * as it can be.
 *
 * The script does two things. It notices an interaction, and it stamps the
 * element with a one-time token so Node can find it again. It computes no
 * selectors, reads no accessibility data, and makes no decisions — all of that
 * happens in Node through first-class Playwright APIs, the same ones 4a's
 * `describeElement` uses. Anything this script derived would be a second
 * implementation of logic that already exists, running in the least trustworthy
 * place available.
 *
 * It is a string rather than a module because it is evaluated in the page, not
 * in this process. Nothing here may reference anything outside itself.
 */

/** The attribute the script stamps, and Node locates by. Removed after reading. */
export const CAPTURE_ATTRIBUTE = 'data-orbit-capture';

/** The single channel from page to Node. Named to be obvious in a page's globals. */
export const CAPTURE_BINDING = '__orbitCaptureElement';

/**
 * Where the current mode lives inside the page.
 *
 * A variable rather than a second script, so switching between demonstrating an
 * action and picking a value to read costs nothing. The first attempt
 * re-injected and reloaded, which silently threw away whatever the human had
 * navigated to — and mapping a workflow means recording several steps deep into
 * a flow, so losing the page is losing the session.
 */
export const MODE_GLOBAL = '__orbitCaptureMode';

export type CaptureMode = 'action' | 'pick';

/** What the page reports. Structured, minimal, and never trusted as-is. */
export interface RawCapture {
  readonly token: string;
  readonly type: 'click' | 'fill' | 'pick';
  /** Present for `fill` only: what the human typed, for verification. */
  readonly typedValue?: string;
}

/**
 * Builds the init script for a mode.
 *
 * `action` listens and lets the event through — the click genuinely happens,
 * which is the entire point of demonstrating a step. `pick` intercepts it, so
 * choosing an element to read from performs nothing: an extract step must never
 * fire the page's own handlers just because someone pointed at a value.
 */
export function buildInjectedScript(mode: CaptureMode): string {
  // Serialised deliberately: this runs in the page and closes over nothing.
  return `(() => {
  const ATTRIBUTE = ${JSON.stringify(CAPTURE_ATTRIBUTE)};
  const BINDING = ${JSON.stringify(CAPTURE_BINDING)};
  const MODE_KEY = ${JSON.stringify(MODE_GLOBAL)};

  window[MODE_KEY] = ${JSON.stringify(mode)};

  if (window.__orbitRecorderInstalled) { return; }
  window.__orbitRecorderInstalled = true;

  const currentMode = () => window[MODE_KEY] === 'pick' ? 'pick' : 'action';

  let counter = 0;
  const token = () => ATTRIBUTE + '-' + (++counter) + '-' + Date.now();

  const report = (element, type, typedValue) => {
    if (!element || typeof element.setAttribute !== 'function') { return; }
    const value = token();
    element.setAttribute(ATTRIBUTE, value);
    const payload = { token: value, type: type };
    if (typedValue !== undefined) { payload.typedValue = typedValue; }
    if (typeof window[BINDING] === 'function') { window[BINDING](payload); }
  };

  document.addEventListener('click', (event) => {
    if (currentMode() === 'pick') {
      // Selecting a value to read must not activate the page.
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      report(event.target, 'pick');
      return;
    }
    report(event.target, 'click');
  }, true);

  document.addEventListener('change', (event) => {
    if (currentMode() === 'pick') { return; }
    const target = event.target;
    if (!target || (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA' && target.tagName !== 'SELECT')) { return; }
    report(target, 'fill', typeof target.value === 'string' ? target.value : '');
  }, true);
})();`;
}
