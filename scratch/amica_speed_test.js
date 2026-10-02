// Regression harness for the Amica tick engine (how fast the funnel reacts).
// Run with:  node scratch/amica_speed_test.js
//
// The Amica tab is opened in the background (`chrome.tabs.create({ active: false })`), where
// Chrome clamps timers to one call per second (and to one call a minute after five minutes
// hidden). The funnel therefore has to react to DOM mutations instead of polling, has to skip
// duplicate work, and must not repeat a click or a progress broadcast while it waits.

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'amica_automation.js');
const src = fs.readFileSync(SRC, 'utf8');

// The code-shape checks must look at code, not at prose: the file's own comments explain the
// 50 ms polling loop that was replaced.
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

const code = stripComments(src);

function slice(start, end) {
  const a = src.indexOf(start);
  const b = src.indexOf(end);
  if (a === -1 || b === -1 || b <= a) throw new Error(`Could not slice ${start} .. ${end}`);
  return src.slice(a, b);
}

let passed = 0;
let failed = 0;

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) {
    console.log(`      expected: ${JSON.stringify(expected)}`);
    console.log(`      actual:   ${JSON.stringify(actual)}`);
  }
}

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

function fakeClock(start) {
  let now = start || 100000;
  return {
    advance(ms) {
      now += ms;
    },
    Date: { now: () => now },
  };
}

function fakeTimers() {
  const timers = new Map();
  let id = 0;
  const add = (kind, fn, ms) => {
    const timer = { id: ++id, kind, fn, ms };
    timers.set(timer.id, timer);
    return timer.id;
  };
  return {
    setTimeout: (fn, ms) => add('timeout', fn, ms),
    clearTimeout: (tid) => timers.delete(tid),
    setInterval: (fn, ms) => add('interval', fn, ms),
    clearInterval: (tid) => timers.delete(tid),
    fire: (tid) => {
      const timer = timers.get(tid);
      if (!timer) return false;
      // A one-shot timer is no longer scheduled once it fired; an interval stays.
      if (timer.kind === 'timeout') timers.delete(tid);
      timer.fn();
      return true;
    },
    live: () => [...timers.values()],
    intervals: () => [...timers.values()].filter((t) => t.kind === 'interval'),
    timeouts: () => [...timers.values()].filter((t) => t.kind === 'timeout'),
  };
}

function fakeObserver() {
  const state = { callback: null, target: null, options: null, disconnected: 0 };
  function MutationObserver(cb) {
    state.callback = cb;
  }
  MutationObserver.prototype.observe = function (target, options) {
    state.target = target;
    state.options = options;
  };
  MutationObserver.prototype.disconnect = function () {
    state.disconnected++;
  };
  return {
    Ctor: MutationObserver,
    state,
    mutate: () => {
      if (state.callback) state.callback([], {});
    },
  };
}

function fakeWindow() {
  const listeners = {};
  return {
    listeners,
    addEventListener(type, fn) {
      (listeners[type] = listeners[type] || []).push(fn);
    },
    removeEventListener(type, fn) {
      listeners[type] = (listeners[type] || []).filter((f) => f !== fn);
    },
    fire(type) {
      (listeners[type] || []).slice().forEach((fn) => fn());
    },
    count: (type) => (listeners[type] || []).length,
  };
}

function fakeDocument(opts) {
  const o = opts || {};
  const scans = { wide: 0 };
  return {
    scans,
    documentElement: {},
    getElementById: (id) => (o.ids && o.ids[id] ? { id } : null),
    querySelector: (sel) => (o.selectors && o.selectors[sel] ? { sel } : null),
    querySelectorAll: () => {
      scans.wide++;
      return o.matches || [];
    },
  };
}

// ---------------------------------------------------------------------------
// Module 1: tick engine + step gate + progress reporting
// ---------------------------------------------------------------------------

const engineSrc = slice('  var TICK_MIN_GAP_MS = 60;', '  function sendSuccess(vehicles, profile) {');

let sent = [];
const chromeMock = {
  runtime: {
    sendMessage: (msg) => {
      sent.push(msg);
      return { catch: () => {} };
    },
  },
};

function loadEngine(env) {
  const clock = env.clock || fakeClock();
  const timers = env.timers || fakeTimers();
  const obs = env.obs || fakeObserver();
  const win = env.win || fakeWindow();
  const doc = env.doc || fakeDocument();
  const mod = new Function(
    'setTimeout',
    'clearTimeout',
    'setInterval',
    'clearInterval',
    'MutationObserver',
    'document',
    'window',
    'Date',
    'chrome',
    engineSrc +
      '\nreturn { createTicker, stepGate, sendProgress, TICK_MIN_GAP_MS, SAFETY_TICK_MS, MAX_RUNTIME_MS, STEP_RETRY_MS, PROGRESS_DEDUP_MS };'
  )(
    timers.setTimeout,
    timers.clearTimeout,
    timers.setInterval,
    timers.clearInterval,
    obs.Ctor,
    doc,
    win,
    clock.Date,
    chromeMock
  );
  return { mod, clock, timers, obs, win, doc };
}

console.log('\n== Amica tick engine ==\n');

// ---- the loop reacts to the page instead of polling -------------------------
{
  const env = loadEngine({});
  const calls = [];
  const ticker = env.mod.createTicker((now, reason) => calls.push({ now, reason }));

  check('nothing runs before start()', calls.length, 0);

  ticker.start();
  check('the first step runs immediately', calls.length, 1);
  check('the first step gets the current timestamp', calls[0].now, 100000);
  check('the first step is tagged', calls[0].reason, 'start');

  check('a MutationObserver drives the loop', !!env.obs.state.callback, true);
  check('the whole document is observed', env.obs.state.target, env.doc.documentElement);
  check('childList + subtree', [env.obs.state.options.childList, env.obs.state.options.subtree], [true, true]);
  check('text changes are seen', env.obs.state.options.characterData, true);
  check('attribute changes are seen', env.obs.state.options.attributes, true);
  check(
    'only meaningful attributes are watched',
    ['class', 'disabled', 'hidden', 'style'].every((a) => env.obs.state.options.attributeFilter.includes(a)),
    true
  );
  check(
    'unrelated attributes are ignored (no needless wake-ups)',
    env.obs.state.options.attributeFilter.some((a) => ['id', 'name', 'src'].includes(a)),
    false
  );

  env.clock.advance(200);
  env.obs.mutate();
  check('a DOM change steps the funnel', calls.length, 2);
  check('the DOM change is tagged', calls[1].reason, 'mutation');

  // A burst of mutations inside the minimum gap must not step over and over.
  env.clock.advance(10);
  env.obs.mutate();
  env.obs.mutate();
  env.obs.mutate();
  check('a burst of mutations is coalesced', calls.length, 2);
  check('one follow-up is queued for the burst', env.timers.timeouts().length, 1);
  check('the follow-up waits out the minimum gap', env.timers.timeouts()[0].ms, env.mod.TICK_MIN_GAP_MS);

  env.clock.advance(env.mod.TICK_MIN_GAP_MS);
  env.timers.fire(env.timers.timeouts()[0].id);
  check('the coalesced work still runs', calls.length, 3);
  check('the coalesced work is tagged', calls[2].reason, 'follow-up');
  check('no follow-up timer is left behind', env.timers.timeouts().length, 0);

  // ---- safety timer ---------------------------------------------------------
  check('a slow safety timer exists', env.timers.intervals().length, 1);
  check('the safety timer is 400 ms, not a 50 ms poll', env.timers.intervals()[0].ms, env.mod.SAFETY_TICK_MS);
  env.clock.advance(env.mod.SAFETY_TICK_MS);
  env.timers.fire(env.timers.intervals()[0].id);
  check('the safety timer steps the funnel', calls.length, 4);
  check('the safety timer is tagged', calls[3].reason, 'interval');

  // ---- waking up on visibility / navigation --------------------------------
  ['visibilitychange', 'focus', 'pageshow', 'popstate', 'hashchange'].forEach((type) => {
    check(`listens for ${type}`, env.win.count(type), 1);
  });
  env.clock.advance(100);
  env.win.fire('visibilitychange');
  check('coming back to the tab steps immediately', calls.length, 5);
  check('the wake-up is tagged', calls[4].reason, 'wake');

  // ---- re-entrancy ---------------------------------------------------------
  const nested = loadEngine({});
  const nestedCalls = [];
  const nestedTicker = nested.mod.createTicker((now) => {
    nestedCalls.push(now);
    nested.obs.mutate(); // our own step mutating the page must not recurse
  });
  nestedTicker.start();
  check('a step that mutates the page does not re-enter itself', nestedCalls.length, 1);

  // ---- a broken step must not kill the loop --------------------------------
  const broken = loadEngine({});
  let brokenRuns = 0;
  const brokenTicker = broken.mod.createTicker(() => {
    brokenRuns++;
    if (brokenRuns === 1) throw new Error('boom');
  });
  brokenTicker.start();
  broken.clock.advance(200);
  broken.obs.mutate();
  check('a throwing step does not stop the loop', brokenRuns, 2);

  // ---- stop() -----------------------------------------------------------------
  const stopping = loadEngine({});
  let stopRuns = 0;
  const stopper = stopping.mod.createTicker(() => stopRuns++);
  stopping.clock.advance(10);
  stopper.start();

  const safetyId = stopping.timers.intervals()[0].id;
  stopping.clock.advance(5000);
  stopping.obs.mutate();
  const runsBeforeStop = stopRuns;
  stopper.stop();

  check('stop() disconnects the observer', stopping.obs.state.disconnected, 1);
  check('stop() clears the safety timer', stopping.timers.intervals().length, 0);
  check('stop() removes the wake-up listeners', stopping.win.count('visibilitychange'), 0);

  stopping.timers.fire(safetyId);
  stopping.obs.mutate();
  stopping.win.fire('visibilitychange');
  check('nothing runs after stop()', stopRuns, runsBeforeStop);
}

// ---- step gate -------------------------------------------------------------
{
  const env = loadEngine({});
  const state = {};

  check('first action of a step is allowed', env.mod.stepGate(state, 'bundle', 1000), true);
  check('the same step is blocked right away', env.mod.stepGate(state, 'bundle', 1100), false);
  check('still blocked just before the retry window', env.mod.stepGate(state, 'bundle', 2499), false);
  check('retried once the window passed', env.mod.stepGate(state, 'bundle', 2500), true);
  check('a different step acts immediately', env.mod.stepGate(state, 'customer', 2501), true);
  check('the retry window is not a full second', env.mod.STEP_RETRY_MS < 3000, true);
}

// ---- progress dedup --------------------------------------------------------
{
  const env = loadEngine({});
  sent = [];

  env.mod.sendProgress(2, 6, 'Entering street address and location...');
  check('progress is reported', sent.length, 1);

  env.mod.sendProgress(2, 6, 'Entering street address and location...');
  check('the same progress line is not repeated on every tick', sent.length, 1);

  env.mod.sendProgress(2, 6, 'Amica rejected 11 Bad Rd, Akron, OH - trying the next address...');
  check('a new progress line goes out', sent.length, 2);

  env.clock.advance(env.mod.PROGRESS_DEDUP_MS + 1);
  env.mod.sendProgress(2, 6, 'Amica rejected 11 Bad Rd, Akron, OH - trying the next address...');
  check('the same line is re-sent once the window passed', sent.length, 3);
  check('the message still carries the provider', sent[2].provider, 'amica');
  check('the message still carries the step', [sent[2].step, sent[2].totalSteps], [2, 6]);
}

// ---------------------------------------------------------------------------
// Module 2: clickElement (one click, no smooth scrolling, disabled respected)
// ---------------------------------------------------------------------------

const clickSrc = slice('  function clickElement(el) {', '  function copyToClipboard(text) {');

function loadClicker(env) {
  const e = env || {};
  return new Function(
    'Event',
    'MouseEvent',
    'PointerEvent',
    clickSrc + '\nreturn { clickElement };'
  )(e.Event, e.MouseEvent, e.PointerEvent);
}

function windowlessClicker() {
  class FakeEvent {
    constructor(type, init) {
      this.type = type;
      this.bubbles = !!(init && init.bubbles);
      this.cancelable = !!(init && init.cancelable);
    }
  }
  class FakeMouseEvent extends FakeEvent {}
  class FakePointerEvent extends FakeEvent {}
  return {
    Event: FakeEvent,
    MouseEvent: FakeMouseEvent,
    PointerEvent: FakePointerEvent,
    FakeEvent,
  };
}

console.log('\n== Amica page actions ==\n');

function fakeClickTarget() {
  const dispatched = [];
  const scrolls = [];
  return {
    dispatched,
    scrolls,
    disabled: false,
    ariaDisabled: null,
    closest: () => null,
    focus: () => {},
    getAttribute: (name) => (name === 'aria-disabled' ? null : null),
    scrollIntoView: (opts) => scrolls.push(opts),
    dispatchEvent: (ev) => {
      dispatched.push(ev.type);
      return true;
    },
  };
}

{
  const ctor = windowlessClicker();
  const { clickElement } = loadClicker(ctor);
  const target = fakeClickTarget();

  clickElement(target);

  check('the pointer sequence is sent', target.dispatched.slice(0, 4), [
    'pointerdown',
    'mousedown',
    'pointerup',
    'mouseup',
  ]);
  check('exactly one click is sent', target.dispatched.filter((t) => t === 'click').length, 1);
  check('the click comes last', target.dispatched[target.dispatched.length - 1], 'click');
  check('all five events are sent', target.dispatched.length, 5);
  check('scrolling is instant, not smooth', target.scrolls[0].behavior, 'auto');

  // Browsers without PointerEvent (or a page that breaks the constructor) still get a click.
  const noPointer = { ...ctor, PointerEvent: undefined };
  const { clickElement: clickNoPointer } = loadClicker(noPointer);
  const fallbackTarget = fakeClickTarget();
  clickNoPointer(fallbackTarget);
  check('a click is still sent without PointerEvent', fallbackTarget.dispatched.filter((t) => t === 'click').length, 1);

  // A disabled button must be left alone instead of being asked to act.
  const disabledTarget = fakeClickTarget();
  disabledTarget.disabled = true;
  clickElement(disabledTarget);
  check('a disabled button is not clicked', disabledTarget.dispatched.length, 0);

  const ariaTarget = fakeClickTarget();
  ariaTarget.getAttribute = (name) => (name === 'aria-disabled' ? 'true' : null);
  clickElement(ariaTarget);
  check('an aria-disabled button is not clicked', ariaTarget.dispatched.length, 0);

  // A click target inside a wrapper button resolves to the button.
  const innerButton = fakeClickTarget();
  const inner = { closest: () => innerButton };
  clickElement(inner);
  check('the click is sent to the surrounding button', innerButton.dispatched.filter((t) => t === 'click').length, 1);
}

// ---------------------------------------------------------------------------
// Module 3: the wide "no vehicles found" scan is reused instead of re-run
// ---------------------------------------------------------------------------

const noVehiclesSrc = slice(
  '  // The wide text scan below',
  '  function sendEmpty(message, profile) {'
);

function loadNoVehicles(env) {
  const clock = env.clock;
  const doc = env.doc;
  return new Function(
    'Date',
    'document',
    noVehiclesSrc + '\nreturn { checkAmicaNoVehiclesFound, NO_VEHICLES_SCAN_GAP_MS };'
  )(clock.Date, doc);
}

console.log('\n== Amica "no vehicles" detection ==\n');

{
  const clock = fakeClock();
  const doc = fakeDocument({ matches: [] });
  const mod = loadNoVehicles({ clock, doc });

  check('empty page -> not the vehicle-entry screen', mod.checkAmicaNoVehiclesFound(), false);
  check('the wide scan ran once', doc.scans.wide, 1);

  clock.advance(10);
  mod.checkAmicaNoVehiclesFound();
  mod.checkAmicaNoVehiclesFound();
  check('the wide scan is reused inside the window', doc.scans.wide, 1);

  clock.advance(mod.NO_VEHICLES_SCAN_GAP_MS + 1);
  mod.checkAmicaNoVehiclesFound();
  check('the scan runs again once the window passed', doc.scans.wide, 2);

  const hit = fakeDocument({ ids: { 'VEHICLE_INFO_ENTRY_OPTION-fieldset': true }, matches: [] });
  const hitMod = loadNoVehicles({ clock: fakeClock(), doc: hit });
  check('the cheap id check answers first', hitMod.checkAmicaNoVehiclesFound(), true);
  check('the wide scan is skipped when an id already answered', hit.scans.wide, 0);

  const textDoc = fakeDocument({
    matches: [{ textContent: "How would you like to enter your vehicle info?" }],
  });
  const textMod = loadNoVehicles({ clock: fakeClock(), doc: textDoc });
  check('the text fallback still detects the screen', textMod.checkAmicaNoVehiclesFound(), true);
}

// ---------------------------------------------------------------------------
// Static checks: the polling loop is gone and every stop path shuts the ticker
// ---------------------------------------------------------------------------

console.log('\n== Amica loop wiring ==\n');

const tickBody = stripComments(slice('    var ticker = createTicker(function (now) {', '    ticker.start();'));

check('the run is driven by the ticker', tickBody.includes('var ticker = createTicker(function (now) {'), true);
check('the ticker is started', code.includes('ticker.start();'), true);
check('no 50 ms polling interval is left', /setInterval\([^;]*,\s*50\s*\)/.test(code), false);
check('no clearInterval(interval) is left', code.includes('clearInterval(interval)'), false);
check('the tick reuses the ticker timestamp', tickBody.includes('var now = Date.now();'), false);
check('the ticker is stopped when vehicles are found', tickBody.includes('state.vehiclesFound = true;'), true);
check('every stop path stops the ticker', (tickBody.match(/ticker\.stop\(\)/g) || []).length, 5);
check('step failures are reported to the caller', tickBody.includes('onError: function (e)'), true);
check('step failures are sent to the user and clear the pending quote', [
  tickBody.includes('sendError('),
  tickBody.includes('clearPendingQuote();'),
], [true, true]);
check('the updated quote ZIP field is targeted', code.includes('getElementById("zip-input-quote_hero")'), true);
check('landing controls are queried inside their quote form', code.includes('landingForm.querySelector('), true);
check('Auto + Home is preferred over Auto-only', code.includes('"PrivatePassenger|HO3"') && code.includes('"PrivatePassenger"'), true);
check(
  'address submission targets Amica Start Your Quote instead of a generic submit',
  /button\.quote-flyout-panel__button\[data-id="GetaQuote\.aStartQuote"\]/.test(code) &&
    !/button\[data-id="GetaQuote\.aStartQuote"\],\s*button\[type="submit"\]/.test(code),
  true
);
check('address CTA uses native button activation', /quoteButton\.click\(\)/.test(code), true);
check('address submit timer is set only after a usable CTA is activated', [
  /if \(!form\.startQuoteBtn\) return;/.test(code),
  /quoteButton\.disabled/.test(code),
  /quoteButton\.click\(\);\s*state\.addressClickedAt = now;/.test(code),
], [true, true, true]);
check('updated Amica form is identified by its #addressForm container', /getElementById\("addressForm"\)/.test(code), true);
check('hidden native street input does not gate the address step', /addressForm\.offsetParent !== null/.test(code), true);
check('Google address autocomplete receives the street value', [
  /streetAutocomplete\.value = street/.test(code),
  /streetAutocomplete\.setAttribute\("value", street\)/.test(code),
], [true, true]);
check('the run is capped by MAX_RUNTIME_MS', tickBody.includes('now - state.startTime > MAX_RUNTIME_MS'), true);
check('the old 90 s literal is gone', tickBody.includes('90000'), false);
check('a stuck page cannot leave the ticker running', code.includes('}, MAX_RUNTIME_MS + 15000);'), true);
check('actions are no longer a second apart', tickBody.includes('now - state.lastActionTime < ACTION_THROTTLE_MS'), true);
check(
  'each funnel step acts once before retrying',
  ['driver', 'contact', 'customer', 'bundle', 'zip'].map((key) => code.includes(`stepGate(state, "${key}", now)`)),
  [true, true, true, true, true]
);
check('the address step keeps its own retry bookkeeping', code.includes('stepGate(state, "address"'), false);

console.log(`\n=== TOTAL: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);