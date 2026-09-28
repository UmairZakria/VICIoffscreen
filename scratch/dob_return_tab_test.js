// Regression harness for the DOB/Unmask tab hand-off.
// Run with:  node scratch/dob_return_tab_test.js
//
// A DOB run opens its own Unmask tab in the background. When a Cloudflare check appears the
// user is taken to that tab so they can watch it being solved, and once the run is over they
// must end up back on the tab they started from (the widget's page, or whichever page the popup
// / standalone window was opened over) - never on a closing lookup tab.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'background.js'), 'utf8');

function slice(start, end, label) {
  const a = src.indexOf(start);
  const b = src.indexOf(end, a);
  if (a === -1 || b === -1 || b <= a) throw new Error(`Could not slice ${label}`);
  return src.slice(a, b);
}

let passed = 0;
const failures = [];
function check(name, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed++;
  } else {
    failures.push(name);
    console.log(
      `FAIL  ${name}\n        expected: ${JSON.stringify(expected)}\n        actual:   ${JSON.stringify(actual)}`
    );
  }
}
function ok(name, condition) {
  check(name, !!condition, true);
}

// ---- the shipped helpers ------------------------------------------------------
const helpersSrc =
  slice('function isWebPageUrl(url) {', 'chrome.tabs.onActivated.addListener(', 'isWebPageUrl') +
  slice('async function storedDobSession() {', 'async function startDobLookup(', 'lookup tab helpers');

// ---- fake browser ------------------------------------------------------------
function fakeChrome(config) {
  const cfg = config || {};
  const log = {
    activated: [],
    focusedWindows: [],
    removes: [],
    storageGets: [],
    storageRemoves: []
  };
  return {
    log,
    api: {
      tabs: {
        async get(tabId) {
          const tab = (cfg.tabs || {})[tabId];
          if (!tab) throw new Error('No tab with id: ' + tabId);
          return tab;
        },
        async update(tabId, props) {
          if (props && props.active) log.activated.push(tabId);
          return (cfg.tabs || {})[tabId] || { id: tabId };
        },
        async remove(tabId) {
          log.removes.push(tabId);
        },
        async query() {
          return cfg.activeTabs || [];
        }
      },
      windows: {
        async update(windowId, props) {
          if (props && props.focused) log.focusedWindows.push(windowId);
          return { id: windowId };
        }
      },
      storage: {
        local: {
          async get(keys) {
            log.storageGets.push(keys);
            return cfg.stored || {};
          },
          async remove(keys) {
            log.storageRemoves.push(keys);
          }
        }
      }
    }
  };
}

function loadHelpers(config) {
  const cfg = config || {};
  const chrome = cfg.chrome || fakeChrome(cfg).api;
  const timer = { fn: null, ms: null };
  const mod = new Function(
    'chrome',
    'activeDobLookup',
    'lastUserTabId',
    'setTimeout',
    'THATSTHEM_STORAGE_KEY',
    helpersSrc +
      '\nreturn { isWebPageUrl, storedDobSession, resolveCallerTabId, restoreCallerTab, endDobLookup };'
  )(
    chrome,
    cfg.lookup || null,
    cfg.lastUserTabId === undefined ? null : cfg.lastUserTabId,
    (fn, ms) => {
      timer.fn = fn;
      timer.ms = ms;
      return 1;
    },
    'thatsthem_pending_lookup'
  );
  return { mod, timer };
}

console.log('\n== which tab to return to ==\n');

(async function () {
  {
    const f = fakeChrome({ activeTabs: [{ id: 42, url: 'https://www.example.com/', windowId: 3 }] });
    const { mod } = loadHelpers({ chrome: f.api, lastUserTabId: null });

    check('a real page counts', mod.isWebPageUrl('https://unmask.com/phone/330-284-7582'), true);
    check('a chrome:// page does not', mod.isWebPageUrl('chrome://extensions'), false);
    check('an extension page does not', mod.isWebPageUrl('chrome-extension://abc/window.html'), false);
    check('about:blank does not', mod.isWebPageUrl('about:blank'), false);
    check('an empty url does not', mod.isWebPageUrl(''), false);

    check('the widget tells us its own tab', await mod.resolveCallerTabId({ tab: { id: 7 } }), 7);
    check(
      'a sender tab is trusted even without a url',
      await mod.resolveCallerTabId({ tab: { id: 8 } }),
      8
    );
  }

  {
    const f = fakeChrome({ activeTabs: [{ id: 42, url: 'https://www.example.com/', windowId: 3 }] });
    const { mod } = loadHelpers({ chrome: f.api, lastUserTabId: 11 });
    check('without a sender tab the last web tab wins', await mod.resolveCallerTabId({}), 11);
  }

  {
    const f = fakeChrome({ activeTabs: [{ id: 42, url: 'https://www.example.com/', windowId: 3 }] });
    const { mod } = loadHelpers({ chrome: f.api, lastUserTabId: null });
    check('with nothing remembered the active tab is used', await mod.resolveCallerTabId({}), 42);
  }

  {
    const f = fakeChrome({ activeTabs: [{ id: 43, url: 'chrome-extension://abc/window.html', windowId: 3 }] });
    const { mod } = loadHelpers({ chrome: f.api, lastUserTabId: null });
    check('an extension page is never a return target', await mod.resolveCallerTabId({}), null);
  }

  console.log('\n== handing the tab back ==\n');

  {
    const f = fakeChrome({
      tabs: {
        5: { id: 5, active: true, windowId: 3, url: 'https://unmask.com/phone/330-284-7582' },
        9: { id: 9, active: false, windowId: 3, url: 'https://www.example.com/' }
      }
    });
    const { mod } = loadHelpers({ chrome: f.api, lastUserTabId: 9 });

    const restored = await mod.restoreCallerTab({ callerTabId: 9 }, 5);
    check('the caller tab is activated while the lookup tab is on screen', restored, true);
    check('the caller tab is the one activated', f.log.activated, [9]);
    check('its window is focused too', f.log.focusedWindows, [3]);
  }

  {
    // The user already switched away from Unmask - their choice wins.
    const f = fakeChrome({
      tabs: {
        5: { id: 5, active: false, windowId: 3, url: 'https://unmask.com/phone/330-284-7582' },
        9: { id: 9, active: true, windowId: 3, url: 'https://www.example.com/' }
      }
    });
    const { mod } = loadHelpers({ chrome: f.api, lastUserTabId: 9 });

    check('nothing is stolen while the user is elsewhere', await mod.restoreCallerTab({ callerTabId: 9 }, 5), false);
    check('no tab was activated', f.log.activated, []);
    check('no window was focused', f.log.focusedWindows, []);
  }

  {
    const f = fakeChrome({
      tabs: { 5: { id: 5, active: true, windowId: 3, url: 'https://unmask.com/phone/330-284-7582' } }
    });
    const { mod } = loadHelpers({ chrome: f.api, lastUserTabId: null });
    check('a closed caller tab is skipped', await mod.restoreCallerTab({ callerTabId: 9 }, 5), false);
    check('nothing was activated', f.log.activated, []);
  }

  {
    const f = fakeChrome({
      tabs: { 5: { id: 5, active: true, windowId: 3, url: 'https://unmask.com/phone/330-284-7582' } }
    });
    const { mod } = loadHelpers({ chrome: f.api, lastUserTabId: null });
    check('no caller id -> no activation', await mod.restoreCallerTab({}, 5), false);
    check('nothing was activated without a caller', f.log.activated, []);
  }

  {
    const f = fakeChrome({
      tabs: { 5: { id: 5, active: true, windowId: 3, url: 'https://unmask.com/phone/330-284-7582' } }
    });
    const { mod } = loadHelpers({ chrome: f.api, lastUserTabId: 5 });
    check('the lookup tab is never its own caller', await mod.restoreCallerTab({ callerTabId: 5 }, 5), false);
    check('nothing was activated for a self return', f.log.activated, []);
  }
})();

(async function () {
  console.log('\n== ending a run ==\n');

  {
    const f = fakeChrome({
      tabs: {
        5: { id: 5, active: true, windowId: 3, url: 'https://unmask.com/phone/330-284-7582' },
        9: { id: 9, active: false, windowId: 3, url: 'https://www.example.com/' }
      }
    });
    const lookup = { tabId: 5, session: { callerTabId: 9 } };
    const { mod, timer } = loadHelpers({ chrome: f.api, lookup, lastUserTabId: 9 });

    await mod.endDobLookup(lookup.session, 1500);
    check('the caller tab is activated right away', f.log.activated, [9]);
    check('the lookup tab stays open for a beat', f.log.removes, []);
    check('the close is scheduled', timer.ms, 1500);

    timer.fn();
    check('the lookup tab closes afterwards', f.log.removes, [5]);
    check('the pending session is dropped', f.log.storageRemoves.length, 1);
    ok('both pending keys are cleared', f.log.storageRemoves[0].includes('unmask_pending_lookup'));
  }

  {
    // The worker was restarted: the session only exists in storage.
    const f = fakeChrome({
      tabs: {
        5: { id: 5, active: true, windowId: 3, url: 'https://unmask.com/phone/330-284-7582' },
        9: { id: 9, active: false, windowId: 3, url: 'https://www.example.com/' }
      },
      stored: { unmask_pending_lookup: { callerTabId: 9 } }
    });
    const lookup = { tabId: 5, session: null };
    const { mod, timer } = loadHelpers({ chrome: f.api, lookup, lastUserTabId: null });

    await mod.endDobLookup(null, 1500);
    check('the session is re-read from storage', f.log.storageGets.length, 1);
    check('the stored caller tab is activated', f.log.activated, [9]);

    timer.fn();
    check('the lookup tab still closes', f.log.removes, [5]);
  }

  {
    const f = fakeChrome({ stored: { thatsthem_pending_lookup: { callerTabId: 9 } } });
    const { mod } = loadHelpers({ chrome: f.api, lastUserTabId: null });
    const session = await mod.storedDobSession();
    check('the ThatSthem session is used when Unmask has none', session.callerTabId, 9);
  }

  {
    // The run moved to another tab (ThatSthem phase) - the old one must not be closed.
    const f = fakeChrome({
      tabs: { 5: { id: 5, active: true, windowId: 3, url: 'https://unmask.com/' } }
    });
    const lookup = { tabId: 5, session: { callerTabId: 9 } };
    const { mod, timer } = loadHelpers({ chrome: f.api, lookup, lastUserTabId: 9 });

    await mod.endDobLookup(lookup.session, 0);
    lookup.tabId = 77;
    timer.fn();
    check('only the tab the run is on gets closed', f.log.removes, []);
  }

  console.log('\n== wiring inside background.js ==\n');

  ok(
    'the DOB starter receives the sender',
    /startDobLookupWithSettings\(request, sendResponse, sender\)/.test(src) &&
      /startDobLookup\(request\.person, request\.phone, sendResponse, sender, record, sources\)/.test(src)
  );
  ok(
    'startDobLookup records the caller tab',
    /session\.callerTabId = await resolveCallerTabId\(sender\)/.test(src)
  );
  ok('finishDobLookup hands the tab back', /endDobLookup\(activeDobLookup && activeDobLookup\.session, 1500\)/.test(src));
  ok('cancelDobLookup hands the tab back', /endDobLookup\(activeDobLookup && activeDobLookup\.session, 0\)/.test(src));
  ok(
    'the empty/error path hands the tab back too',
    /DOB_LOOKUP_EMPTY' \|\| request\.action === 'DOB_LOOKUP_ERROR'\)[\s\S]{0,600}endDobLookup\(/.test(src)
  );
  ok('no inline tab removal is left in the error path', !/DOB_LOOKUP_ERROR'\)[\s\S]{0,300}chrome\.tabs\.remove/.test(src));
  ok('the last web tab is remembered', /chrome\.tabs\.onActivated\.addListener/.test(src));
  ok(
    'extension pages are never remembered',
    /if \(tab && isWebPageUrl\(tab\.url\)\) lastUserTabId = tab\.id/.test(src)
  );
  ok(
    'the challenge tab is surfaced and its window focused',
    /FOCUS_LOOKUP_TAB'\)[\s\S]{0,240}chrome\.tabs\.update\(tabId, \{ active: true \}\)/.test(src) &&
      /FOCUS_LOOKUP_TAB'\)[\s\S]{0,340}chrome\.windows\.update\(sender\.tab\.windowId, \{ focused: true \}\)/.test(src)
  );

  console.log(`\n=== TOTAL: ${passed} passed, ${failures.length} failed ===\n`);
  process.exit(failures.length === 0 ? 0 : 1);
})();
