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
  /** Empty for a navigation, which names no element. */
  readonly token: string;
  readonly type: 'click' | 'fill' | 'pick' | 'navigate';
  /** Present for `navigate` only: where the page went. */
  readonly url?: string;
  /**
   * Present for `fill` only: what the human typed.
   *
   * Absent for a password field, and that absence is the point — see
   * `sensitive` below.
   */
  readonly typedValue?: string;
  /**
   * Set when the field was a password input.
   *
   * The value is never read for such a field, so there is nothing to leak
   * downstream: what a person types into a password box does not enter this
   * process at all. Sub-phase 2.1 made a literal secret unrepresentable in an
   * input declaration; capturing one into a step value would have reintroduced
   * it by another door. The step is still recorded — the field is real and the
   * workflow needs it — with an empty value for a reviewer to bind properly.
   */
  readonly sensitive?: boolean;
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

  const report = (element, type, typedValue, sensitive) => {
    if (!element || typeof element.setAttribute !== 'function') { return; }
    const value = token();
    element.setAttribute(ATTRIBUTE, value);
    const payload = { token: value, type: type };
    if (typedValue !== undefined) { payload.typedValue = typedValue; }
    if (sensitive === true) { payload.sensitive = true; }
    if (typeof window[BINDING] === 'function') { window[BINDING](payload); }
  };

  const reportNavigation = () => {
    if (typeof window[BINDING] !== 'function') { return; }
    window[BINDING]({ token: '', type: 'navigate', url: String(location.href) });
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
    report(event.target, 'click', undefined, false);
  }, true);

  document.addEventListener('change', (event) => {
    if (currentMode() === 'pick') { return; }
    const target = event.target;
    if (!target || (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA' && target.tagName !== 'SELECT')) { return; }

    // A password field's value is never read. The step is still reported so the
    // workflow keeps the field; what was typed simply never leaves the page.
    const isPassword = target.tagName === 'INPUT' && String(target.type).toLowerCase() === 'password';
    if (isPassword) {
      report(target, 'fill', undefined, true);
      return;
    }

    report(target, 'fill', typeof target.value === 'string' ? target.value : '', false);
  }, true);

  // A page change is part of the sequence: without it a recording is a list of
  // clicks with no record of where each happened.
  reportNavigation();
})();`;
}
