// Regression harness for the hidden DOB runner and the security-check promotion.
// Run with:  node scratch/dob_offscreen_test.js
//
// Unmask and ThatSthem now run inside the offscreen document's iframe, so no tab appears in the
// user's tab strip while a DOB run works through its addresses.
//
// A Cloudflare / browser check cannot be solved in a hidden frame - nobody can see it - so the run
// is PROMOTED into a real tab at that point: the user solves the check once, the tab is then
// hidden again and they are returned to the tab they started from, while the run carries on in
// the (now background) lookup tab until it finishes.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const bgSrc = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const unmaskSrc = fs.readFileSync(path.join(root, 'unmask_automation.js'), 'utf8');
const thatsthemSrc = fs.readFileSync(path.join(root, 'thatsthem_automation.js'), 'utf8');
const amicaSrc = fs.readFileSync(path.join(root, 'amica_automation.js'), 'utf8');
const offscreenSrc = fs.readFileSync(path.join(root, 'offscreen.js'), 'utf8');
const offscreenHtml = fs.readFileSync(path.join(root, 'offscreen.html'), 'utf8');
const rules = JSON.parse(fs.readFileSync(path.join(root, 'rules.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}
const bgCode = stripComments(bgSrc);
const unmaskCode = stripComments(unmaskSrc);
const thatsthemCode = stripComments(thatsthemSrc);

function slice(src, start, end, label) {
  const a = src.indexOf(start);
  const b = src.indexOf(end, a);
  if (a === -1 || b === -1 || b <= a) throw new Error('Could not slice ' + label);
  return src.slice(a, b);
}

// The sources offscreen.js can actually serve, read from its own map. The offscreen document reports
// this list when it is pinged, and a runner that is not in it is what "unknown-source" means.
const RUNNER_SOURCES = [...offscreenSrc.matchAll(/'([a-z.]+)':\s*\{\s*frameId:/g)].map((m) => m[1]);

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
// The shipped helpers, loaded as real code
// ---------------------------------------------------------------------------

const runnerSrc = slice(
  bgSrc,
  'function persistDobSession(session) {',
  '// Ends a DOB run:',
  'DOB runner helpers'
);
// startDobInOffscreen() now reports through prepareRunner(), which lives next to
// ensureOffscreenDocument() at the bottom of the file, so both come along as real code as well.
// ensureOffscreenDocument()/prepareRunner() are the last thing in the file, and
// startDobInOffscreen() - which calls them - sits far above them, so this is a tail slice rather
// than a bounded one. Both are plain function declarations, so loading the remainder is harmless.
const offscreenPlumbingSrc = bgSrc.slice(
  bgSrc.indexOf('// `force` drops any open offscreen document first.')
);
const endSrc = slice(
  bgSrc,
  'async function endDobLookup(session, delayMs) {',
  'async function startDobLookup(',
  'endDobLookup'
);

// A fake browser that records the order of every observable effect, so the test can prove the
// pending session is written BEFORE the runner is asked to load.
function fake(cfg) {
  const c = cfg || {};
  const events = [];
  const log = { createdTabs: [], activated: [], focusedWindows: [], removedTabs: [], storage: [] };
  let nextTabId = 100;
  let docOpen = c.hasDocument !== false;

  const chrome = {
    tabs: {
      async create(props) {
        log.createdTabs.push(props);
        events.push('tab.create');
        return { id: nextTabId++, windowId: 3, url: props.url };
      },
      async get(id) { return (c.tabs || {})[id] || null; },
      async update(id, props) {
        if (props && props.active) { log.activated.push(id); events.push('tab.activate:' + id); }
        return { id };
      },
      async remove(id) { log.removedTabs.push(id); events.push('tab.remove:' + id); }
    },
    windows: {
      async update(id, props) {
        if (props && props.focused) log.focusedWindows.push(id);
        return { id };
      }
    },
    storage: {
      local: {
        async set(obj) { log.storage.push(obj); events.push('storage.set'); return undefined; },
        async remove() { return undefined; },
        async get() { return c.stored || {}; }
      }
    },
    runtime: {
      async sendMessage(msg) {
        log.storage.push({ __msg: msg });
        events.push('message:' + msg.action);
        // The document has to answer before it is asked to do anything: the ping is what closes the
        // "created but not listening yet" window that used to send runs into a tab.
        if (msg.action === 'PING_OFFSCREEN') {
          events.push('ping');
          if (c.pingSilent) return undefined;
          return { status: 'pong', runners: c.runners || RUNNER_SOURCES };
        }
        if (msg.action === 'PREPARE_RUNNER') {
          events.push('prepare');
          const seq = c.prepareSequence;
          if (seq && seq.length) {
            const next = seq.shift();
            // 'throw' models the createDocument()/listener race: the message is sent before
            // offscreen.js has registered its listener.
            if (next === 'throw') {
              throw new Error('Could not establish connection. Receiving end does not exist.');
            }
            return next;
          }
          return c.prepareOk === false ? { ok: false, error: 'no-frame' } : { ok: true };
        }
        return { ok: true };
      }
    },
    // A faithful offscreen document: closing it means the next hasDocument() is false, and
    // creating it means it is true again, so the "recreate and retry" path is really exercised.
    offscreen: {
      async hasDocument() { return docOpen; },
      async closeDocument() { docOpen = false; events.push('offscreen.close'); },
      async createDocument() {
        events.push('offscreen.create');
        if (c.createThrows) throw new Error('no offscreen document');
        docOpen = true;
      }
    }
  };

  const box = { v: c.run || null };

  const mod = new Function(
    'chrome',
    'box',
    'storedDobSession',
    'restoreCallerTab',
    'THATSTHEM_STORAGE_KEY',
    'setTimeout',
    'broadcastDobMessage',
    // The real ensureOffscreenDocument()/prepareRunner() come first, so startDobInOffscreen()
    // resolves them from this scope instead of a stand-in.
    offscreenPlumbingSrc +
      '\n' +
      runnerSrc.replace(/\bactiveDobLookup\b/g, 'box.v') +
      '\nreturn { openDobRunner, promoteDobRunToTab, bringLookupIntoView, hideLookupAfterChallenge };'
  )(
    chrome,
    box,
    async () => c.session || null,
    async () => { events.push('restoreCallerTab'); return true; },
    'thatsthem_pending_lookup',
    (fn) => { fn(); return 0; },
    (msg) => { log.storage.push({ __msg: msg }); events.push('broadcast'); }
  );

  return { mod, log, box, events };
}

function loadEnd(cfg) {
  const c = cfg || {};
  const log = { removedTabs: [], storageRemoved: [], messages: [], restoreCalls: 0 };
  const box = { v: c.run || null };
  const chrome = {
    tabs: {
      async remove(id) { log.removedTabs.push(id); },
      async get(id) { return (c.tabs || {})[id] || null; },
      async update() {}
    },
    windows: { async update() {} },
    storage: { local: { async remove(keys) { log.storageRemoved.push(keys); }, async set() {} } },
    runtime: { async sendMessage(m) { log.messages.push(m); return { ok: true }; } }
  };
  const fn = new Function(
    'chrome',
    'box',
    'storedDobSession',
    'restoreCallerTab',
    'setTimeout',
    'THATSTHEM_STORAGE_KEY',
    endSrc.replace(/\bactiveDobLookup\b/g, 'box.v') +
      '\nreturn { endDobLookup };'
  )(
    chrome,
    box,
    async () => c.session || null,
    async () => { log.restoreCalls++; return true; },
    (cb) => { cb(); return 0; },
    'thatsthem_pending_lookup'
  );
  return { end: fn.endDobLookup, log, box };
}

(async () => {
  // -------------------------------------------------------------------------
  console.log('\n== 1. the offscreen runner carries the DOB sites ==\n');
  // -------------------------------------------------------------------------

  const runnersSrc = slice(offscreenSrc, 'const RUNNERS = {', 'function getFrame(', 'RUNNERS');
  const RUNNERS = new Function(runnersSrc + '\nreturn RUNNERS;')();

  check('unmask.com has a runner frame', !!RUNNERS['unmask.com'], true);
  check('thatsthem.com has a runner frame', !!RUNNERS['thatsthem.com'], true);
  check('the unmask frame exists in offscreen.html', offscreenHtml.includes('id="frame-unmask"'), true);
  check('the thatsthem frame exists in offscreen.html', offscreenHtml.includes('id="frame-thatsthem"'), true);
  ok(
    'both DOB frames start parked',
    (offscreenHtml.match(/id="frame-(unmask|thatsthem)" src="about:blank"/g) || []).length === 2
  );

  // PREPARE_RUNNER must accept an explicit url: a DOB run starts on a search URL, not a homepage.
  ok('PREPARE_RUNNER honours an explicit url', /const target = request\.url \|\| runner\.url;/.test(offscreenSrc));
  ok('the explicit url gets a cache-buster', /_r=\$\{Date\.now\(\)\}/.test(offscreenSrc));

  // -------------------------------------------------------------------------
  console.log('\n== 2. framing and injection are wired for both sites ==\n');
  // -------------------------------------------------------------------------

  for (const site of ['unmask.com', 'thatsthem.com']) {
    const rule = rules.find((r) => ((r.condition && r.condition.urlFilter) || '').includes(site));
    ok('rules.json has a ' + site + ' framing rule', !!rule);
    if (rule) {
      const removed = (rule.action.responseHeaders || [])
        .filter((h) => h.operation === 'remove')
        .map((h) => h.header.toLowerCase());
      ok(site + ' rule removes x-frame-options', removed.includes('x-frame-options'));
      ok(site + ' rule removes content-security-policy', removed.includes('content-security-policy'));
      ok(site + ' rule applies to sub_frame', (rule.condition.resourceTypes || []).includes('sub_frame'));
    }

    const script = manifest.content_scripts.find((s) =>
      (s.matches || []).some((m) => m.includes(site))
    );
    ok('the ' + site + ' content script is registered', !!script);
    ok('the ' + site + ' content script may run in the offscreen frame', !!(script && script.all_frames));
  }

  // -------------------------------------------------------------------------
  console.log('\n== 3. the runner handshake covers all three automations ==\n');
  // -------------------------------------------------------------------------

  // Without an answered handshake the automation refuses to start - silently, which is a hang.
  ok(
    'the background answers the handshake',
    /RUNNER_HELLO/.test(bgCode) && /sendResponse\(\{ ok: !sender \|\| !sender\.tab \}\)/.test(bgCode)
  );

  const autos = [
    ['unmask', unmaskSrc, unmaskCode],
    ['thatsthem', thatsthemSrc, thatsthemCode],
    ['amica', amicaSrc, stripComments(amicaSrc)]
  ];
  for (const [label, src, code] of autos) {
    ok(label + ' asks the background before it runs', /action: "RUNNER_HELLO"/.test(src));
    ok(label + ' defines confirmRunnerIsOurs', /function confirmRunnerIsOurs\(callback\)/.test(src));
    ok(label + ' trusts a top-level tab without a round-trip', /if \(window\.parent === window\)/.test(src));
    ok(label + ' treats an unanswered handshake as a refusal', /chrome\.runtime\.lastError/.test(src));
    ok(label + ' never reads the cross-origin parent location', !/parent\.location/.test(code));
    ok(label + ' does not rely on document.referrer', !/document\.referrer/.test(code));
  }

  // The start has to be deferred until the answer arrives, or the run would drive a page the
  // extension may not own.
  ok(
    'unmask defers its start until the handshake is answered',
    /confirmRunnerIsOurs\(function \(isOurs\) \{\s*if \(!isOurs\) return;/.test(unmaskCode)
  );
  ok(
    'thatsthem defers its start until the handshake is answered',
    /confirmRunnerIsOurs\(function \(isOurs\) \{\s*if \(!isOurs\) return;/.test(thatsthemCode)
  );


  // -------------------------------------------------------------------------
  console.log('\n== 4. opening a run uses the hidden runner ==\n');
  // -------------------------------------------------------------------------

  {
    const f = fake({ hasDocument: false });
    const session = { targetName: 'Betty Hyatt' };
    const run = await f.mod.openDobRunner('https://unmask.com/address/3724-Kildare-Dr', session);

    check('no tab is opened', f.log.createdTabs, []);
    check('the run is in offscreen mode', run.mode, 'offscreen');
    check('no tab id is recorded', run.tabId, null);
    check('the step url is recorded on the session', session.currentUrl, 'https://unmask.com/address/3724-Kildare-Dr');

    // The content script reads the session exactly once on load, so it must be in storage first.
    const setAt = f.events.indexOf('storage.set');
    const prepareAt = f.events.indexOf('message:PREPARE_RUNNER');
    ok('the session reaches storage before the runner loads', setAt !== -1 && prepareAt !== -1 && setAt < prepareAt);
    ok(
      'the offscreen document is created before the runner is prepared',
      f.events.indexOf('offscreen.create') !== -1 && f.events.indexOf('offscreen.create') < prepareAt
    );

    // One run spans both sites, so the session is kept under both keys (that is how the ThatSthem
    // script finds it after Unmask is exhausted).
    const written = f.log.storage[0];
    ok('the session is stored under the unmask key', !!written.unmask_pending_lookup);
    ok('the session is stored under the thatsthem key', !!written.thatsthem_pending_lookup);
  }

  {
    // The offscreen document cannot be created at all; the run must still happen, just in a tab.
    const f = fake({ hasDocument: false, createThrows: true });
    const run = await f.mod.openDobRunner('https://unmask.com/address/1', {});
    check('the fallback opens a background tab', f.log.createdTabs.length, 1);
    check('the fallback tab is not focused', f.log.createdTabs[0].active, false);
    check('the fallback tab loads the step url', f.log.createdTabs[0].url, 'https://unmask.com/address/1');
    check('the run is in tab mode', run.mode, 'tab');
    check(
      'the fallback says so, instead of appearing with no explanation',
      f.log.storage.some((m) => m.__msg && /background tab/.test(m.__msg.message || '')),
      true
    );
  }

  {
    // A stale offscreen document (one from an earlier install, without this frame) is recreated
    // and the runner prepared again - that is what keeps a DOB run out of a visible tab.
    const f = fake({ hasDocument: true, prepareSequence: [{ ok: false, error: 'no-frame' }, { ok: true }] });
    const run = await f.mod.openDobRunner('https://unmask.com/address/1', {});

    check('a stale offscreen document is closed and recreated', f.events.includes('offscreen.close'), true);
    check('the runner is prepared a second time', f.events.filter((e) => e === 'prepare').length, 2);
    check('the retry keeps the run hidden', [f.log.createdTabs.length, run.mode], [0, 'offscreen']);
  }

  {
    // A stale document still running the OLD offscreen.js does not know this runner, so it answers
    // "unknown-source" rather than "no-frame". Treating only the latter as staleness is what left
    // every DOB run in a visible tab, so both have to replace the document.
    const f = fake({ hasDocument: true, prepareSequence: [{ ok: false, error: 'unknown-source' }, { ok: true }] });
    const run = await f.mod.openDobRunner('https://unmask.com/address/1', {});

    check('an unknown source also recreates the offscreen document', f.events.includes('offscreen.close'), true);
    check('the run stays hidden after recreating', [f.log.createdTabs.length, run.mode], [0, 'offscreen']);
  }

  {
    // createDocument() resolves before offscreen.js has registered its listener, so the first
    // message can lose to "no receiving end". That is transient and must be retried, not treated
    // as "there is no runner" - otherwise the very first lookup after an extension reload (when
    // the offscreen document is recreated lazily) opens a visible tab.
    const f = fake({ hasDocument: false, prepareSequence: ['throw', { ok: true }] });
    const run = await f.mod.openDobRunner('https://unmask.com/address/1', {});

    check('a transient connection failure is retried', f.events.filter((e) => e === 'prepare').length, 2);
    check('the retry keeps the run hidden', [f.log.createdTabs.length, run.mode], [0, 'offscreen']);
  }

  {
    // THE BUG THIS FIXES. Google's prepare and Unmask's prepare start together (START_DOB_LOOKUP
    // kicks off both), and both land in the same offscreen document. The document is created by
    // whichever gets there first, and `createDocument()` resolves before offscreen.js is listening,
    // so the other one spent its three retries inside that window, gave up and opened a background
    // tab - which is exactly what was seen: Google hidden, Unmask in a tab, one run.
    //
    // The document is now pinged and waited for before anything is asked of it.
    const f = fake({ hasDocument: true });
    const run = await f.mod.openDobRunner('https://unmask.com/address/1', {});

    const pingAt = f.events.indexOf('ping');
    const prepAt = f.events.indexOf('prepare');
    check('the document is pinged before it is asked for a runner', pingAt !== -1 && prepAt !== -1 && pingAt < prepAt, true);
    check('so the run stays hidden', [f.log.createdTabs.length, run.mode], [0, 'offscreen']);
  }

  {
    // A document that answers without this runner is stale, and it says so itself: nothing failed,
    // the list it reported simply does not contain the frame. That has to replace the document
    // rather than being read as "there is no runner".
    const f = fake({ hasDocument: true, runners: ['infolookup.site', 'infolookupp.com'] });
    const run = await f.mod.openDobRunner('https://unmask.com/address/1', {});

    check('nothing is asked of a document that says it has no such runner', f.events.includes('prepare'), false);
    check('the document is replaced', f.events.includes('offscreen.close'), true);
    check('and a run it still cannot serve falls back', [f.log.createdTabs.length, run.mode], [1, 'tab']);
  }

  {
    // A runner that refuses to prepare for any other reason still falls back to a tab.
    const f = fake({ prepareOk: false });
    const run = await f.mod.openDobRunner('https://unmask.com/address/1', {});
    check('a refused runner falls back to a tab', [f.log.createdTabs.length, run.mode], [1, 'tab']);
  }

  // -------------------------------------------------------------------------
  console.log('\n== 5. promoting a run so the user can solve the check ==\n');
  // -------------------------------------------------------------------------

  {
    const session = { currentUrl: 'https://unmask.com/address/3724-Kildare-Dr' };
    const run = { mode: 'offscreen', tabId: null, source: 'unmask.com', session };
    const f = fake({ run });

    const promoted = await f.mod.promoteDobRunToTab('https://unmask.com/CDN-CGI-INTERSTITIAL');

    check('promotion succeeded', promoted, true);
    check('exactly one tab is opened', f.log.createdTabs.length, 1);
    check('the tab is focused so the user sees the check', f.log.createdTabs[0].active, true);
    check('the tab opens on the real step url', f.log.createdTabs[0].url, 'https://unmask.com/address/3724-Kildare-Dr');
    check(
      'the cloudflare interstitial url is not what the user is sent to',
      f.log.createdTabs[0].url === 'https://unmask.com/CDN-CGI-INTERSTITIAL',
      false
    );
    check('the run switches to tab mode', run.mode, 'tab');
    check('the run records the tab', run.tabId, 100);
    check('the window is focused', f.log.focusedWindows, [3]);
    check('the session is marked promoted', session.promotedForChallenge, true);
    check('the session is not yet marked cleared', session.challengeCleared, false);
    check(
      'the offscreen frame is parked so only one runner stays live',
      f.log.storage.some((m) => m.__msg && m.__msg.action === 'RESET_RUNNER' && m.__msg.source === 'unmask.com'),
      true
    );

    // A second report must not open a second tab.
    const again = await f.mod.promoteDobRunToTab('https://unmask.com/whatever');
    check('a repeat promotion opens no extra tab', f.log.createdTabs.length, 1);
    check('a repeat promotion still succeeds', again, true);
    check('a repeat promotion brings the tab forward', f.log.activated, [100]);
  }

  {
    const f = fake({ run: null });
    check('promotion without an active run does nothing', await f.mod.promoteDobRunToTab('https://unmask.com/x'), false);
    check('promotion without a run opens no tab', f.log.createdTabs, []);
  }


  // -------------------------------------------------------------------------
  console.log('\n== 6. hiding the tab again and returning the user ==\n');
  // -------------------------------------------------------------------------

  {
    const session = {
      promotedForChallenge: true,
      challengeCleared: false,
      callerTabId: 9,
      currentUrl: 'https://unmask.com/address/3724-Kildare-Dr'
    };
    const run = { mode: 'tab', tabId: 100, source: 'unmask.com', session };
    const f = fake({ run });

    await f.mod.hideLookupAfterChallenge({ tab: { id: 100, windowId: 3 } });

    check('the user is sent back to the tab they started from', f.events.includes('restoreCallerTab'), true);
    check('the session records the hand-back', session.challengeCleared, true);

    // The tab is deliberately kept. Closing it flapped: whether a hidden frame gets challenged is
    // not the same question as whether a top-level tab does, so the frame came back challenged and
    // the run was promoted again - a tab opening and closing over and over.
    check('the tab is not closed', f.log.removedTabs, []);
    check('the run stays in the tab that can pass the check', [run.mode, run.tabId], ['tab', 100]);
    check('the run is never handed back to the frame', run.mode === 'offscreen', false);

    // Idempotent: the automation may report it more than once.
    f.events.length = 0;
    await f.mod.hideLookupAfterChallenge({ tab: { id: 100, windowId: 3 } });
    check('a second report does not steal the user back again', f.events.includes('restoreCallerTab'), false);
  }

  {
    // A second check later in the same tab must still hand the user back: the cleared flag belongs
    // to the previous check, so it is reset whenever a new one appears.
    const session = { promotedForChallenge: true, challengeCleared: true, callerTabId: 9 };
    const run = { mode: 'tab', tabId: 100, source: 'unmask.com', session };
    const f = fake({ run });

    await f.mod.bringLookupIntoView({ tab: { id: 100, windowId: 3 } });

    check('a new check clears the previous hand-back flag', session.challengeCleared, false);
    check('the tab is brought forward for the new check', f.log.activated, [100]);

    await f.mod.hideLookupAfterChallenge({ tab: { id: 100, windowId: 3 } });
    check('the user is handed back for the second check too', f.events.includes('restoreCallerTab'), true);
  }

  {
    // The offscreen frame reports challenges too, and must never be able to hide the user's view.
    const session = { promotedForChallenge: true };
    const run = { mode: 'tab', tabId: 100, source: 'unmask.com', session };
    const f = fake({ run });

    await f.mod.hideLookupAfterChallenge({ url: 'https://unmask.com/x' });
    check('a report with no tab is ignored', f.events.includes('restoreCallerTab'), false);

    await f.mod.hideLookupAfterChallenge({ tab: { id: 777 } });
    check('a report from another tab is ignored', f.events.includes('restoreCallerTab'), false);
    check('nothing was marked cleared', session.challengeCleared, undefined);
  }

  {
    const run = { mode: 'offscreen', tabId: null, source: 'unmask.com', session: {} };
    const f = fake({ run });
    await f.mod.hideLookupAfterChallenge({ tab: { id: 100 } });
    check('an offscreen run never hides anything', f.events.includes('restoreCallerTab'), false);
  }

  // -------------------------------------------------------------------------
  console.log('\n== 7. bringing the check into view ==\n');
  // -------------------------------------------------------------------------

  {
    const session = { currentUrl: 'https://unmask.com/address/1' };
    const f = fake({ run: { mode: 'offscreen', tabId: null, source: 'unmask.com', session } });
    await f.mod.bringLookupIntoView({ url: 'https://unmask.com/address/1' });
    check('an offscreen run is promoted into a tab', f.log.createdTabs.length, 1);
  }

  {
    // The fallback path: the run is already in its own tab, so it is just activated - and marked
    // so that it also hides itself once the check is gone.
    const session = { currentUrl: 'https://unmask.com/address/1' };
    const run = { mode: 'tab', tabId: 100, source: 'unmask.com', session };
    const f = fake({ run });
    await f.mod.bringLookupIntoView({ tab: { id: 100, windowId: 3 } });
    check('an existing tab is activated, not duplicated', [f.log.createdTabs.length, f.log.activated], [0, [100]]);
    check('the session is marked so the tab hides itself later', session.promotedForChallenge, true);
  }

  {
    // Amica / Mercury have no DOB session; the sender's own tab is simply activated.
    const f = fake({ run: null });
    await f.mod.bringLookupIntoView({ tab: { id: 55, windowId: 2 } });
    check('a non-DOB run just activates its own tab', f.log.activated, [55]);
    check('a non-DOB run opens no tab', f.log.createdTabs, []);
  }


  // -------------------------------------------------------------------------
  console.log('\n== 8. ending the run ==\n');
  // -------------------------------------------------------------------------

  {
    const f = loadEnd({
      run: { mode: 'offscreen', tabId: null, source: 'unmask.com', session: { callerTabId: 9 } }
    });
    await f.end({ callerTabId: 9 }, 1500);
    check('an offscreen run closes no tab', f.log.removedTabs, []);
    check('an offscreen run never grabs the user', f.log.restoreCalls, 0);
    check('an offscreen run parks the frame instead', f.log.messages.map((m) => m.action), ['RESET_RUNNER']);
    check('the pending session is dropped', f.log.storageRemoved[0].includes('unmask_pending_lookup'), true);
    check('both session keys are dropped', f.log.storageRemoved[0].includes('thatsthem_pending_lookup'), true);
  }

  {
    const f = loadEnd({
      run: { mode: 'tab', tabId: 100, source: 'unmask.com', session: { callerTabId: 9 } }
    });
    await f.end({ callerTabId: 9 }, 1500);
    check('a tab run hands the user back', f.log.restoreCalls, 1);
    check('a tab run closes its tab', f.log.removedTabs, [100]);
    check('a tab run does not touch the offscreen frame', f.log.messages, []);
  }

  // -------------------------------------------------------------------------
  console.log('\n== 9. the automations report the hand-back ==\n');
  // -------------------------------------------------------------------------

  for (const [label, src, code] of [['unmask', unmaskSrc, unmaskCode], ['thatsthem', thatsthemSrc, thatsthemCode]]) {
    ok(label + ' tells the background the check is cleared', /action: "CHALLENGE_CLEARED"/.test(src));
    ok(label + ' only reports once', /challengeClearedSent/.test(code));
    ok(
      label + ' reports it only for a promoted run',
      /session\.promotedForChallenge && !state\.challengeClearedSent/.test(code)
    );

    // It must sit AFTER the challenge branch, which returns while a check is up - otherwise a run
    // would report "cleared" while the user is still looking at the check.
    const branchReturn = code.indexOf('return; // watch the page');
    const notifyAt = code.indexOf('notifyChallengeCleared();');
    ok(label + ' cannot report "cleared" while a check is on screen', branchReturn !== -1 && notifyAt > branchReturn);
  }

  // -------------------------------------------------------------------------
  console.log('\n== 10. a check is only seen when there really is one ==\n');
  // -------------------------------------------------------------------------

  // This is the bug behind the visible tab: the detector used to treat anything Cloudflare-ish as
  // a challenge, so a normal unmask.com page - which carries Cloudflare's bot-management script,
  // and can embed a Turnstile widget of its own - looked like a check. The run then promoted
  // itself into a visible tab on every single lookup, with nothing there to solve.
  const detectorSrc = slice(
    unmaskSrc,
    'function isCloudflareChallengePage() {',
    '// Realistic human click dispatcher',
    'isCloudflareChallengePage'
  );

  // A page is described by its title plus the selectors that actually match on it.
  function isChallenge(opts) {
    const o = opts || {};
    const present = o.present || [];
    const doc = {
      title: o.title || '',
      querySelector(selector) {
        const wanted = String(selector).split(',').map((s) => s.trim());
        for (const w of wanted) if (present.includes(w)) return { tagName: 'MAIN' };
        return null;
      }
    };
    return new Function(
      'document',
      '"use strict";' + detectorSrc + '\nreturn isCloudflareChallengePage();'
    )(doc);
  }

  // The markers that are NOT specific to a challenge page must be gone.
  check('the detector no longer keys off a Turnstile widget', /iframe\[src\*='turnstile'\]/.test(detectorSrc), false);
  check('the detector no longer keys off a Turnstile script', /challenges\.cloudflare\.com/.test(detectorSrc), false);
  check(
    'the detector no longer keys off the generic challenge-platform script',
    /script\[src\*='challenge-platform'\]/.test(detectorSrc),
    false
  );

  // ...while everything the real interstitial actually has still reports a check. These values
  // come from cloudflare's own markup: <main class="challenge"> with challenge__* children.
  ok('the interstitial title is recognised', isChallenge({ title: 'Performing security verification' }) === true);
  ok('main.challenge is recognised', isChallenge({ present: ['main.challenge'] }) === true);
  ok('the challenge hero is recognised', isChallenge({ present: ['.challenge__hero'] }) === true);
  ok('the challenge title element is recognised', isChallenge({ present: ['.challenge__title'] }) === true);
  ok('the challenge-page script is recognised', isChallenge({ present: ["script[src*='chl_page']"] }) === true);
  ok('the older just-a-moment title still works', isChallenge({ title: 'Just a moment...' }) === true);

  // ...and a normal results page is NOT a check, however much Cloudflare it carries.
  ok(
    'a normal page loading cloudflare bot-management is not a check',
    isChallenge({ title: 'Unmask - Find Anyone', present: ["script[src*='challenge-platform']"] }) === false
  );
  ok(
    'a normal page embedding a Turnstile widget is not a check',
    isChallenge({ title: 'Unmask - Find Anyone', present: ["iframe[src*='turnstile']"] }) === false
  );
  ok(
    'a normal page with neither is not a check',
    isChallenge({ title: 'Unmask - Find Anyone' }) === false
  );


  console.log('\n' + passed + ' passed, ' + failures.length + ' failed\n');
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error('Harness error:', e);
  process.exit(1);
});

