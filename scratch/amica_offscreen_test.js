// Regression harness for the hidden Amica runner (the quote flow moved into the offscreen
// document's iframe instead of opening a tab).
// Run with:  node scratch/amica_offscreen_test.js
//
// Covers the four things that can silently break the move:
//   1. the frame guard in amica_automation.js must accept the extension's own offscreen frame
//      and still refuse a frame belonging to some other site;
//   2. the offscreen runner map must cover every source that is dispatched to it, and must not
//      guess a frame for an unknown source the way the old `includes()` ternary did;
//   3. the pending quote has to be written to storage BEFORE the frame is told to load, or the
//      automation reads nothing on load and the run never starts;
//   4. finishing a run has to park the frame back on about:blank and clear the right storage
//      key, in both offscreen and tab mode.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const bgSrc = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const amicaSrc = fs.readFileSync(path.join(root, 'amica_automation.js'), 'utf8');
const offscreenSrc = fs.readFileSync(path.join(root, 'offscreen.js'), 'utf8');
const offscreenHtml = fs.readFileSync(path.join(root, 'offscreen.html'), 'utf8');
const rules = JSON.parse(fs.readFileSync(path.join(root, 'rules.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}
const bgCode = stripComments(bgSrc);
const amicaCode = stripComments(amicaSrc);
const offscreenCode = stripComments(offscreenSrc);

function slice(src, start, end, label) {
  const a = src.indexOf(start);
  const b = src.indexOf(end, a);
  if (a === -1 || b === -1 || b <= a) throw new Error('Could not slice ' + label);
  return src.slice(a, b);
}

let passed = 0;
const failures = [];
function check(name, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) passed++;
  else {
    failures.push(name);
    console.log(
      'FAIL  ' + name +
      '\n        expected: ' + JSON.stringify(expected) +
      '\n        actual:   ' + JSON.stringify(actual)
    );
  }
}
function ok(name, cond) { check(name, !!cond, true); }

// ---------------------------------------------------------------------------
console.log('\n== 1. the frame guard in amica_automation.js ==\n');
// ---------------------------------------------------------------------------

// Pull the REAL helper out of the shipped file and run it against fake windows. This is the
// check the whole run hangs on: if the frame never learns it is allowed to start, the UI sits
// on "Initializing Amica vehicle lookup..." forever.
const guardSrc = slice(
  amicaSrc,
  'function confirmRunnerIsOurs(callback) {',
  '// Start when page is loaded',
  'confirmRunnerIsOurs'
);

// Drives the shipped helper. `parentIsSelf` models a top-level tab; `sender` models what the
// background sees when it answers - a tab, the offscreen document, or nobody at all.
function loadGuard(parentIsSelf, sender) {
  const fakeWindow = { parent: null };
  if (parentIsSelf) fakeWindow.parent = fakeWindow;

  const chrome = {
    runtime: {
      lastError: undefined,
      sendMessage(msg, cb) {
        if (sender === 'no-answer') {
          // Nobody is listening, so the callback fires with lastError set.
          this.lastError = { message: 'Could not establish connection.' };
          cb(undefined);
          return;
        }
        cb({ ok: !sender || !sender.tab });
      }
    }
  };

  return new Function(
    'window',
    'chrome',
    guardSrc +
      '\nvar verdict = "not-called";' +
      '\nconfirmRunnerIsOurs(function (v) { verdict = v; });' +
      '\nreturn verdict;'
  )(fakeWindow, chrome);
}

check('a normal top-level tab is trusted without a round-trip', loadGuard(true, { tab: { id: 5 } }), true);
check('the offscreen runner frame is accepted', loadGuard(false, {}), true);
check('a frame embedded by a page in a real tab is refused', loadGuard(false, { tab: { id: 9 } }), false);
check('an unanswered handshake is refused, never assumed to be a yes', loadGuard(false, 'no-answer'), false);

// The background must actually answer, or every offscreen run refuses and the UI hangs.
ok(
  'the background answers the handshake',
  /RUNNER_HELLO/.test(bgCode) &&
    /sendResponse\(\{ ok: !sender \|\| !sender\.tab \}\)/.test(bgCode)
);
ok(
  'the frame sends the handshake the background answers',
  /action: "RUNNER_HELLO"/.test(amicaCode)
);
ok(
  'an unanswered handshake is treated as a refusal',
  /chrome\.runtime\.lastError/.test(guardSrc)
);
ok(
  'the start waits for the handshake before driving the quote flow',
  /confirmRunnerIsOurs\(function \(isOurs\) \{\s*if \(!isOurs\) return;/.test(amicaCode)
);
ok(
  'the old unconditional `window !== window.top` bail-out is gone',
  !/if \(window !== window\.top\) return;/.test(amicaCode)
);
ok(
  'the frame does not read the cross-origin parent location (it throws)',
  !/parent\.location/.test(guardSrc)
);
ok(
  'the frame does not rely on document.referrer (empty for an extension parent)',
  !/document\.referrer/.test(guardSrc)
);
ok(
  'the de-duplication flag is still set up front',
  /window\.__amicaAutomationLoaded/.test(amicaCode)
);

// ---------------------------------------------------------------------------
console.log('\n== 2. the offscreen runner map ==\n');
// ---------------------------------------------------------------------------

// Load the real RUNNERS table out of offscreen.js.
const runnersSrc = slice(offscreenSrc, 'const RUNNERS = {', 'function getFrame(', 'RUNNERS');
const RUNNERS = new Function(runnersSrc + '\nreturn RUNNERS;')();

check(
  'every dispatched source has a frame',
  ['infolookup.site', 'infolookupp.com', 'amica.com'].filter((s) => !RUNNERS[s]),
  []
);
check(
  'amica runs on the Amica homepage',
  RUNNERS['amica.com'].url,
  'https://www.amica.com/'
);
check(
  'the two existing lookups still point where they did',
  [RUNNERS['infolookup.site'].url, RUNNERS['infolookupp.com'].url],
  ['https://infolookup.site/', 'https://infolookupp.com/']
);
check(
  'each runner has a frame of its own',
  new Set(Object.values(RUNNERS).map((r) => r.frameId)).size,
  Object.keys(RUNNERS).length
);

// Every frame id in the map has to exist in offscreen.html, or the run silently no-ops.
for (const [source, runner] of Object.entries(RUNNERS)) {
  ok(
    'offscreen.html has a ' + runner.frameId + ' iframe for ' + source,
    new RegExp('id="' + runner.frameId + '"').test(offscreenHtml)
  );
}
ok(
  'offscreen.html declares an Amica frame',
  /id="frame-amica"/.test(offscreenHtml)
);
// The Amica frame must not eagerly load Amica: it would grab a session before a quote is
// asked for, and the cookie wipe in startAmicaInOffscreen is what guarantees a fresh one.
const amicaIframeTag = offscreenHtml.slice(offscreenHtml.indexOf('id="frame-amica"'));
ok(
  'the Amica frame starts on about:blank, not on amica.com',
  !/id="frame-amica"[^>]*src="https/.test(offscreenHtml)
);

// The old heuristic mapped anything that was not infolookup onto the second source's frame, which
// sent an unlisted source to the wrong page entirely.
ok(
  'the source->frame guess (`includes(\'infolookup\') ? ... : ...`) is gone',
  !/includes\(['"]infolookup['"]\)/.test(offscreenCode)
);
ok(
  'an unlisted source is reported instead of being guessed at',
  /unknown-source/.test(offscreenCode)
);
ok(
  'offscreen.js is strict mode, so an unlisted source cannot leak a global',
  /['"]use strict['"]/.test(offscreenSrc)
);

// The runners must be laid out, not display:none - a hidden frame has a zero-size layout
// box and Amica will not render its quote flow in one.
ok(
  'the runners are not display:none',
  !/#runners[^{]*\{[^}]*display:\s*none/.test(offscreenHtml)
);

// ---------------------------------------------------------------------------
console.log('\n== 3. starting a quote offscreen ==\n');
// ---------------------------------------------------------------------------

// Run the real startAmicaInOffscreen against a fake chrome, recording call order.
const startSrc = slice(
  bgSrc,
  'async function startAmicaInOffscreen(profile) {',
  'async function clearAmicaCookies() {',
  'startAmicaInOffscreen'
);

function fakeChromeForStart(opts) {
  const cfg = opts || {};
  const log = { order: [], stored: [], removed: [], messages: [], cookies: [] };
  const api = {
    log,
    cookies: {
      async getAll() { return []; },
      async remove(o) { log.cookies.push(o); }
    },
    storage: {
      local: {
        async set(obj) {
          log.order.push('set');
          Object.assign(log.stored, obj);
        },
        async remove(keys) { log.order.push('remove'); log.removed.push(keys); }
      }
    },
    offscreen: {
      async hasDocument() { return true; }
    },
    runtime: {
      sendMessage: async (msg) => {
        log.order.push('message:' + msg.action);
        log.messages.push(msg);
        if (cfg.prepareResponse !== undefined) return cfg.prepareResponse;
        return { ok: true };
      }
    }
  };
  return api;
}

// `activeVehicleLookup` is a module-level `let` in the real file, so the assignment inside the
// slice is redirected at a box the test owns, and the slice is then invoked with the profile
// bound the same way the real caller binds it.
async function runStart(profile, cfg) {
  const chrome = fakeChromeForStart(cfg);
  const log = chrome.log;
  const ensure = async () => { log.order.push('ensure'); };
  const clearFn = new Function(
    'chrome',
    slice(bgSrc, 'async function clearAmicaCookies() {', '// Ends a run in whichever mode', 'clearAmicaCookies') +
      '\nreturn clearAmicaCookies;'
  )(chrome);

  const box = { v: null };
  const call = new Function(
    'chrome',
    'box',
    'ensureOffscreenDocument',
    'clearAmicaCookies',
    'profile',
    startSrc.replace(/activeVehicleLookup = \{/g, 'box.v = {') +
      '\nreturn startAmicaInOffscreen(profile).then(function (r) { return { started: r, run: box.v }; });'
  );
  const res = await call(chrome, box, ensure, clearFn, profile);
  return { ...res, log };
}

// Same slice, for the case where the offscreen document itself cannot be created.
async function runStartWithoutOffscreen(profile) {
  const chrome = fakeChromeForStart({});
  const log = chrome.log;
  const ensureThrows = async () => { throw new Error('no offscreen document'); };
  const clearFn = new Function(
    'chrome',
    slice(bgSrc, 'async function clearAmicaCookies() {', '// Ends a run in whichever mode', 'clearAmicaCookies') +
      '\nreturn clearAmicaCookies;'
  )(chrome);
  const box = { v: null };
  const call = new Function(
    'chrome',
    'box',
    'ensureOffscreenDocument',
    'clearAmicaCookies',
    'profile',
    startSrc.replace(/activeVehicleLookup = \{/g, 'box.v = {') +
      '\nreturn startAmicaInOffscreen(profile).then(function (r) { return { started: r, run: box.v }; });'
  );
  return { ...(await call(chrome, box, ensureThrows, clearFn, profile)), log };
}

(async () => {
  const okStart = await runStart({ name: 'Jane Doe', address: { zip: '76133' } });
  check('an offscreen Amica run reports success', okStart.started, true);
  check('the run is recorded as offscreen with no tab', [okStart.run.tabId, okStart.run.offscreen], [null, true]);

  // The ordering that matters: the automation reads the pending quote once, on load.
  const setAt = okStart.log.order.indexOf('set');
  const msgAt = okStart.log.order.indexOf('message:PREPARE_RUNNER');
  const ensureAt = okStart.log.order.indexOf('ensure');
  ok('the pending quote is written before the frame is asked to load', setAt !== -1 && msgAt !== -1 && setAt < msgAt);
  ok('the offscreen document exists before the frame is asked to load', ensureAt < msgAt);
  check(
    'the frame is asked for by source, not by a guessed name',
    okStart.log.messages[0],
    { action: 'PREPARE_RUNNER', source: 'amica.com' }
  );
  check('the pending quote is written under the key the automation reads', Object.keys(okStart.log.stored), ['amica_pending_quote']);

  // A rejected prepare must not leave a pending quote behind for the next page load to pick up.
  const badStart = await runStart({ name: 'Jane Doe' }, { prepareResponse: { ok: false, error: 'no-frame' } });
  check('a refused prepare falls back instead of pretending to run', badStart.started, false);
  check('the pending quote is rolled back when the prepare is refused', badStart.log.removed, [['amica_pending_quote']]);
  check('no run is left dangling after a refused prepare', badStart.run, null);

  // If the offscreen document cannot even be created, the caller must fall back to a tab
  // rather than reporting a run that will never happen.
  const res2 = await runStartWithoutOffscreen({ name: 'Jane Doe' });
  check('a failure to create the offscreen document falls back to the tab path', res2.started, false);
  check('a failed start leaves no pending quote behind', res2.log.removed, [['amica_pending_quote']]);

  // The tab path must remain reachable for Mercury, and for Amica when offscreen is unusable.
  ok('Mercury is not diverted into the offscreen frame', !/provider === 'mercury'/.test(slice(bgSrc, 'async function startVehicleLookup', '// The offscreen path for Amica', 'startVehicleLookup').replace(/\/\/.*$/gm, '')));
  ok('Amica keeps a tab fallback', /falling back to a background tab/.test(bgSrc));
  ok('Amica is offered the offscreen frame first', /if \(provider === 'amica'\) \{[\s\S]*?startAmicaInOffscreen\(profile\)/.test(bgCode));
  const progressHandler = slice(
    bgSrc,
    "if (request.action === 'VEHICLE_LOOKUP_PROGRESS') {",
    "if (request.action === 'VEHICLE_LOOKUP_SUCCESS')",
    'vehicle progress handler'
  );
  ok(
    'the startup-only progress line leaves the warm fallback armed',
    /request\.message !== 'Starting Amica vehicle automation\.\.\.'/.test(progressHandler)
  );

  // -------------------------------------------------------------------------
  console.log('\n== 4. finishing a run ==\n');
  // -------------------------------------------------------------------------

  const finishSrc = slice(
    bgSrc,
    'function finishVehicleLookup({ clearQuote = true, prepareNext = true } = {}) {',
    'function cancelVehicleLookup(sendResponse) {',
    'finishVehicleLookup'
  );

  function runFinish(run, opts) {
    const options = opts || {};
    const log = { removed: [], resets: [], messages: [], prewarms: 0 };
    const chrome = {
      tabs: { async remove(id) { log.removed.push(id); } },
      storage: { local: { async remove(k) { log.removed.push(k); } } },
      runtime: { sendMessage: async (m) => { log.messages.push(m); log.resets.push(m); } }
    };
    const box = { v: run };
    // The next Amica is loaded by a separate function, so it is stubbed to record that it happened.
    const prewarmAmica = async () => { log.prewarms++; };
    // `activeVehicleLookup` is a module-level `let` in the real file, so every reference to
    // it in the slice is redirected at the box this test owns.
    const fn = new Function(
      'chrome',
      'box',
      'prewarmAmica',
      finishSrc.replace(/\bactiveVehicleLookup\b/g, 'box.v') +
        '\nfinishVehicleLookup(' + (options.call || '') + '); return box.v;'
    );
    return { after: fn(chrome, box, prewarmAmica), log };
  }

  const offscreenRun = runFinish({ tabId: null, provider: 'amica', offscreen: true });
  check('an offscreen run does not try to close a tab', offscreenRun.log.removed, [['amica_pending_quote']]);
  check('an offscreen run parks the frame back on about:blank', offscreenRun.log.messages, [
    { action: 'RESET_RUNNER', source: 'amica.com' }
  ]);
  check('the run is cleared so a late message cannot re-close anything', offscreenRun.after, null);
  check('a finished offscreen run loads the next Amica', offscreenRun.log.prewarms, 1);

  const replacingRun = runFinish(
    { tabId: null, provider: 'amica', offscreen: true },
    { call: '{ prepareNext: false }' }
  );
  check('clearing the way for a new run does not pre-load', replacingRun.log.prewarms, 0);

  const tabRun = runFinish({ tabId: 42, provider: 'amica' });
  check('a tab run still closes its tab', tabRun.log.removed[0], 42);
  check('a tab run does not touch the offscreen frame', tabRun.log.messages, []);
  check('a tab run does not pre-load either', tabRun.log.prewarms, 0);

  const mercuryRun = runFinish({ tabId: 7, provider: 'mercury' });
  check('a Mercury run clears only the Mercury quote', mercuryRun.log.removed[1], ['mercury_pending_quote']);
  check('Mercury never pre-loads Amica', mercuryRun.log.prewarms, 0);

  ok('finishVehicleLookup is a no-op when no run is active', /if \(!activeVehicleLookup\) return;/.test(finishSrc));
  ok('every teardown path goes through finishVehicleLookup', (bgCode.match(/finishVehicleLookup\(/g) || []).length >= 4);

  // -------------------------------------------------------------------------
  console.log('\n== 5. wiring ==\n');
  // -------------------------------------------------------------------------

  // Amica sends x-frame-options: SAMEORIGIN, so the header has to be stripped or the frame
  // renders a blank refusal and the run times out.
  const amicaRule = rules.find((r) => (r.condition && r.condition.urlFilter || '').includes('amica.com'));
  ok('rules.json strips the framing headers for amica.com', !!amicaRule);
  if (amicaRule) {
    const removed = (amicaRule.action.responseHeaders || [])
      .filter((h) => h.operation === 'remove')
      .map((h) => h.header.toLowerCase());
    ok('amica.com rule removes x-frame-options', removed.includes('x-frame-options'));
    ok('amica.com rule removes content-security-policy', removed.includes('content-security-policy'));
    ok('the amica.com rule applies to sub_frame', (amicaRule.condition.resourceTypes || []).includes('sub_frame'));
  }

  const amicaScript = manifest.content_scripts.find((s) => (s.js || []).includes('amica_automation.js'));
  ok('the Amica content script is registered', !!amicaScript);
  ok('the Amica content script is allowed to run in the offscreen frame', !!(amicaScript && amicaScript.all_frames));

  ok('offscreen permission is still declared', manifest.permissions.includes('offscreen'));
  ok('amica host permissions are present', manifest.host_permissions.some((h) => h.includes('amica.com')));

  console.log('\n' + passed + ' passed, ' + failures.length + ' failed\n');
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error('Harness error:', e);
  process.exit(1);
});