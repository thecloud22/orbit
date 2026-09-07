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
 * How long the page will wait for Node to finish deriving before acting anyway.
 *
 * A ceiling, not a delay: derivation normally resolves in a few milliseconds
 * and the action proceeds immediately. It exists so a page can never be left
 * permanently unclickable because the binding stopped answering — losing a
 * capture is bad, wedging the browser somebody is working in is worse.
 */
const DERIVATION_BUDGET_MS = 2000;

/**
 * Builds the init script for a mode.
 *
 * `action` intercepts the interaction, waits for Node to finish deriving the
 * element it names, and then replays it. `pick` intercepts and never replays,
 * so choosing an element to read from performs nothing: an extract step must
 * never fire the page's own handlers just because someone pointed at a value.
 *
 * Action mode used to listen passively and let the event through, which was
 * simpler and silently wrong. Derivation happens in Node, one round trip after
 * the event; a click that submits a form or follows a link tears down the
 * document — and its execution context — before that round trip can finish, so
 * Playwright discarded the in-flight call and the interaction was recorded as
 * nothing at all. Not even a failure: the error path lives in the context that
 * just died. Every existing test passed because the demo portal re-renders in
 * place and never navigates, while on a real site the steps that submit a form
 * or follow a link are most of the workflow.
 *
 * Waiting is therefore not a nicety. It is the only point at which the element
 * still exists to be described.
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

  /**
   * Everything reported so far, chained in order.
   *
   * A click waits on this before it is allowed to proceed, so the fill that
   * preceded it is derived before the submit it triggers can navigate away.
   * Without the chain a typed value is lost to the very button that makes the
   * step worth recording.
   */
  let pending = Promise.resolve();

  /** Resolves when the promise settles or the budget expires, whichever is first. */
  const bounded = (promise) => new Promise((resolve) => {
    let settled = false;
    const finish = () => { if (!settled) { settled = true; resolve(); } };
    promise.then(finish, finish);
    setTimeout(finish, ${DERIVATION_BUDGET_MS});
  });

  const report = (element, type, typedValue, sensitive) => {
    if (!element || typeof element.setAttribute !== 'function') { return Promise.resolve(); }
    if (typeof window[BINDING] !== 'function') { return Promise.resolve(); }
    const value = token();
    element.setAttribute(ATTRIBUTE, value);
    const payload = { token: value, type: type };
    if (typedValue !== undefined) { payload.typedValue = typedValue; }
    if (sensitive === true) { payload.sensitive = true; }
    const call = pending.then(() => window[BINDING](payload)).catch(() => undefined);
    pending = call;
    return call;
  };

  const reportNavigation = () => {
    if (typeof window[BINDING] !== 'function') { return; }
    window[BINDING]({ token: '', type: 'navigate', url: String(location.href) });
  };

  // Set while the recorder itself is re-issuing an interaction it held back, so
  // the replay is let through instead of being intercepted a second time.
  let replaying = false;

  document.addEventListener('click', (event) => {
    if (replaying) { return; }

    if (currentMode() === 'pick') {
      // Selecting a value to read must not activate the page.
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      report(event.target, 'pick');
      return;
    }

    const target = event.target;
    if (!target || typeof target.dispatchEvent !== 'function') { return; }

    // Held back, not cancelled: the page must not navigate out from under the
    // derivation that names the element this click acted on.
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    bounded(report(target, 'click', undefined, false)).then(() => {
      replaying = true;
      try {
        if (typeof target.click === 'function') {
          target.click();
        } else {
          target.dispatchEvent(new MouseEvent('click', {
            bubbles: true, cancelable: true, composed: true, view: window,
          }));
        }
      } finally {
        replaying = false;
      }
    });
  }, true);

  // Submitting by pressing Enter never produces a click, so without this the
  // field just typed into is lost to the navigation the form causes.
  let resubmitting = false;

  document.addEventListener('submit', (event) => {
    if (resubmitting) { return; }

    const form = event.target;

    if (currentMode() === 'pick') {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      return;
    }

    if (!form || typeof form.dispatchEvent !== 'function') { return; }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    // Nothing new to report — the fields and the button already reported
    // themselves. What this waits for is those reports finishing.
    bounded(pending).then(() => {
      resubmitting = true;
      try {
        if (typeof form.requestSubmit === 'function') {
          form.requestSubmit();
        } else if (typeof form.submit === 'function') {
          form.submit();
        }
      } finally {
        resubmitting = false;
      }
    });
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
