// Regression harness for the Cloudflare / Turnstile click engine.
// Run with:  node scratch/trusted_click_test.js
//
// The old "Engine 1" replayed the recorded cursor path with synthetic DOM events and never
// cleared a challenge - Cloudflare only trusts real input. The trusted click (Engine 2,
// dispatched over the Chrome DevTools Protocol by background.js) is the only engine left, so
// this harness drives the real coordinate resolution + click dispatch that ship inside
// unmask_automation.js / thatsthem_automation.js with a fake DOM, and checks the challenge
// branches at source level so Engine 1 cannot creep back in.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

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

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function slice(src, start, end, label) {
  const a = src.indexOf(start);
  const b = src.indexOf(end, a);
  if (a === -1 || b === -1 || b <= a) throw new Error(`Could not slice ${label} (${start})`);
  return src.slice(a, b);
}

// ---- the two content scripts that solve the challenge ------------------------
const BLOCK_START = '  // ---- Trusted click target resolution';

const AUTOMATIONS = [
  {
    file: 'unmask_automation.js',
    label: 'Unmask',
    blockEnd: '  // Realistic human click dispatcher',
    branchStart: '      // SCENARIO 0: Cloudflare Turnstile Challenge Intercept',
    branchEnd: '      // SCENARIO 1: On Profile Page',
    macroKey: 'recorded_macro_unmask',
    containerSelector: '#captcha-container',
    resetsInBranch: true
  },
  {
    file: 'thatsthem_automation.js',
    label: 'ThatSthem',
    blockEnd: '  // Fingerprint of the parsed cards',
    branchStart: '      if (isBrowserCheckPage()) {',
    branchEnd: '      // Verification cleared (or was never shown)',
    macroKey: 'recorded_macro_thatsthem',
    containerSelector: '#captcha-container',
    // ThatSthem resets its counters after the branch, in the "verification cleared" block.
    resetsInBranch: false
  }
];

AUTOMATIONS.forEach((spec) => {
  spec.src = read(spec.file);
  spec.block = slice(spec.src, BLOCK_START, spec.blockEnd, `${spec.label} trusted click block`);
  spec.branch = slice(spec.src, spec.branchStart, spec.branchEnd, `${spec.label} challenge branch`);
});

// ---- fake DOM ---------------------------------------------------------------
function rectOf(left, top, width, height) {
  return { left, top, width, height, right: left + width, bottom: top + height };
}

function widgetEl(opts) {
  const o = opts || {};
  return {
    tagName: o.tagName || 'IFRAME',
    scrollCalls: [],
    scrollIntoView(arg) {
      this.scrollCalls.push(arg);
    },
    getBoundingClientRect() {
      if (o.rectThrows) throw new Error('layout unavailable');
      return o.rect || null;
    }
  };
}

// <input type=hidden name="cf-turnstile-response"> - the only light DOM part of a widget that
// lives inside a closed shadow root.
function responseInput(host) {
  return { tagName: 'INPUT', type: 'hidden', name: 'cf-turnstile-response', parentElement: host || null };
}

function fakeDoc(config) {
  const cfg = config || {};
  const doc = {
    selectors: [],
    created: [],
    appended: [],
    querySelector(sel) {
      doc.selectors.push(sel);
      if (/iframe/i.test(sel)) return cfg.iframe || null;
      // The hidden response input of a declarative-shadow-DOM widget.
      if (/cf-turnstile-response|cf-chl-widget/.test(sel)) return cfg.response || null;
      return cfg.fallback || null;
    },
    createElement(tag) {
      const el = { tagName: String(tag).toUpperCase(), style: { cssText: '' }, parentNode: null };
      doc.created.push(el);
      return el;
    }
  };
  doc.body = {
    appendChild(el) {
      el.parentNode = doc.body;
      doc.appended.push(el);
    },
    removeChild() {}
  };
  doc.documentElement = { appendChild() {} };
  return doc;
}

function fakeChrome(behaviour) {
  const b = behaviour || {};
  const stub = {
    sent: [],
    runtime: {
      sendMessage(msg, cb) {
        if (b.throws) throw new Error('Receiving end does not exist');
        stub.sent.push(msg);
        if (cb) cb(b.respond ? b.respond(msg) : { success: true });
      }
    }
  };
  return stub;
}

// Builds the real shipped helpers + `replayMacroEngine2` with the fakes injected.
function loadEngine(spec, config) {
  const cfg = config || {};
  const factory = new Function(
    'document',
    'window',
    'chrome',
    'requestAnimationFrame',
    'setTimeout',
    spec.block +
      '\n  return { resolveTrustedClickPoint, checkboxPointForRect, pointInsideRect,' +
      ' findTurnstileElement, showClickRipple, replayMacroEngine2, trustedClickDue,' +
      ' TRUSTED_CLICK_SETTLE_MS, TRUSTED_CLICK_GAP_MS, TRUSTED_CLICK_MAX, TRUSTED_CLICK_FOCUS_AFTER };'
  );
  return factory(
    cfg.doc || fakeDoc(),
    cfg.window || { innerWidth: 1200, innerHeight: 800 },
    cfg.chrome || fakeChrome(),
    (fn) => fn(),
    () => 0
  );
}

// Drives the real challenge branch of a run loop with a controlled clock, so the escalation
// (settle -> repeated trusted clicks -> tab surfaced) can be stepped through.
function makeTimeline(spec) {
  const state = {
    processed: false,
    challengeDetectedAt: 0,
    challengeReplayInProgress: false,
    challengeClicks: 0,
    challengeLastClickAt: 0,
    challengeFocusAsked: false,
    lastCalibratedCoords: null
  };
  const clock = { now: 1000 };
  const calls = { clicks: [], focus: 0, next: 0, advance: 0 };
  const pendingStorage = [];
  let challengeUp = true;
  const pacing = loadEngine(spec, {});

  const tick = new Function(
    'state',
    'isCloudflareChallengePage',
    'isBrowserCheckPage',
    'sendProgress',
    'chrome',
    'focusThisTab',
    'resolveTrustedClickPoint',
    'replayMacroEngine2',
    'showClickRipple',
    'Date',
    'advanceToNextAddress',
    'clickBrowserCheckRetry',
    'next',
    'BROWSER_CHECK_MAX_MS',
    'trustedClickDue',
    'TRUSTED_CLICK_FOCUS_AFTER',
    'TRUSTED_CLICK_MAX',
    `return async function tick() { ${spec.branch} };`
  )(
    state,
    () => challengeUp,
    () => challengeUp,
    () => {},
    { storage: { local: { get(keys, cb) { pendingStorage.push(cb); } } } },
    () => {
      calls.focus++;
    },
    () => ({ x: 130, y: 233, source: 'widget' }),
    (x, y) => {
      calls.clicks.push({ x, y });
      return Promise.resolve(true);
    },
    () => {},
    { now: () => clock.now },
    () => {
      calls.advance++;
    },
    () => false,
    () => {
      calls.next++;
    },
    90000,
    pacing.trustedClickDue,
    pacing.TRUSTED_CLICK_FOCUS_AFTER,
    pacing.TRUSTED_CLICK_MAX
  );

  return {
    state,
    calls,
    pacing,
    clockNow: () => clock.now,
    // The branch itself decides when to stop clicking: the moment the check page is gone the
    // challenge code is not reached at all.
    setChallenge(up) {
      challengeUp = !!up;
    },
    async advanceTo(ms) {
      clock.now = ms;
      await tick();
      while (pendingStorage.length) {
        await pendingStorage.shift()({ [spec.macroKey]: MACRO });
      }
    }
  };
}

// ---- coordinates for the trusted click ---------------------------------------
const WIDGET = rectOf(100, 200, 300, 66); // checkbox -> x 130, y 233
const WIDE = rectOf(0, 0, 1200, 300); // full width wrapper - the checkbox is NOT at its left edge
const MACRO = { click: { x: 150, y: 220 }, path: [{ x: 12, y: 14 }, { x: 150, y: 220 }] };

console.log('\n== coordinates for the trusted click ==\n');

AUTOMATIONS.forEach((spec) => {
  const L = spec.label;
  const withDoc = (config) => loadEngine(spec, config);

  let live = widgetEl({ rect: WIDGET });
  const doc = fakeDoc({ iframe: live });
  check(`${L}: widget checkbox point`, withDoc({ doc }).resolveTrustedClickPoint(null), {
    x: 130,
    y: 233,
    source: 'widget'
  });
  check(`${L}: widget (iframe) is queried first`, /iframe/.test(doc.selectors[0]), true);
  check(`${L}: a found widget needs no container lookup`, doc.selectors.length, 1);
  check(
    `${L}: widget is scrolled into view before measuring`,
    JSON.stringify(live.scrollCalls[0]),
    JSON.stringify({ behavior: 'auto', block: 'center' })
  );

  check(
    `${L}: recorded point inside the widget is kept`,
    withDoc({ doc: fakeDoc({ iframe: widgetEl({ rect: WIDGET }) }) }).resolveTrustedClickPoint(MACRO),
    { x: 150, y: 220, source: 'recorded' }
  );

  check(
    `${L}: recorded point outside the widget is recalibrated`,
    withDoc({ doc: fakeDoc({ iframe: widgetEl({ rect: WIDGET }) }) }).resolveTrustedClickPoint({
      click: { x: 900, y: 700 }
    }),
    { x: 130, y: 233, source: 'widget' }
  );

  // widget still loading (zero sized) -> the recording is all we have
  check(
    `${L}: zero sized widget falls back to the recorded point`,
    withDoc({ doc: fakeDoc({ iframe: widgetEl({ rect: rectOf(0, 0, 0, 0) }) }) }).resolveTrustedClickPoint(MACRO),
    { x: 150, y: 220, source: 'recorded' }
  );
  check(
    `${L}: zero sized widget without a recording -> viewport centre`,
    withDoc({ doc: fakeDoc({ iframe: widgetEl({ rect: rectOf(0, 0, 0, 0) }) }) }).resolveTrustedClickPoint(null),
    { x: 600, y: 400, source: 'viewport' }
  );

  check(
    `${L}: unreadable layout keeps the recorded point`,
    withDoc({ doc: fakeDoc({ iframe: widgetEl({ rectThrows: true }) }) }).resolveTrustedClickPoint(MACRO),
    { x: 150, y: 220, source: 'recorded' }
  );
  check(
    `${L}: unreadable layout without a recording -> viewport centre`,
    withDoc({ doc: fakeDoc({ iframe: widgetEl({ rectThrows: true }) }) }).resolveTrustedClickPoint(null),
    { x: 600, y: 400, source: 'viewport' }
  );

  const wideDoc = fakeDoc({ fallback: widgetEl({ tagName: 'DIV', rect: WIDE }) });
  check(
    `${L}: a full width wrapper is not treated as the widget`,
    withDoc({ doc: wideDoc }).resolveTrustedClickPoint(MACRO),
    { x: 150, y: 220, source: 'recorded' }
  );
  check(
    `${L}: container selector used as fallback`,
    wideDoc.selectors.some((sel) => sel.includes(spec.containerSelector)),
    true
  );
  check(
    `${L}: full width wrapper without a recording -> viewport centre`,
    withDoc({ doc: fakeDoc({ fallback: widgetEl({ tagName: 'DIV', rect: WIDE }) }) }).resolveTrustedClickPoint(null),
    { x: 600, y: 400, source: 'viewport' }
  );
  check(
    `${L}: nothing on the page -> viewport centre`,
    withDoc({ doc: fakeDoc() }).resolveTrustedClickPoint(null),
    { x: 600, y: 400, source: 'viewport' }
  );

  // ---- declarative shadow DOM: the iframe is invisible, the host is measurable ----------
  const host = widgetEl({ tagName: 'DIV', rect: WIDGET });
  const shadowDoc = fakeDoc({ response: responseInput(host) });
  check(
    `${L}: a closed shadow widget is measured through its response input`,
    withDoc({ doc: shadowDoc }).resolveTrustedClickPoint(null),
    { x: 130, y: 233, source: 'widget' }
  );
  check(`${L}: the shadow widget host is queried second`, /cf-turnstile-response/.test(shadowDoc.selectors[1]), true);
  check(
    `${L}: the shadow widget host is scrolled into view`,
    JSON.stringify(host.scrollCalls[0]),
    JSON.stringify({ behavior: 'auto', block: 'center' })
  );
  check(
    `${L}: a recording inside the closed shadow widget is kept`,
    withDoc({ doc: fakeDoc({ response: responseInput(widgetEl({ tagName: 'DIV', rect: WIDGET })) }) }).resolveTrustedClickPoint(
      MACRO
    ),
    { x: 150, y: 220, source: 'recorded' }
  );
  check(
    `${L}: a not-yet-rendered shadow widget falls back to the recording`,
    withDoc({ doc: fakeDoc({ response: responseInput(widgetEl({ tagName: 'DIV', rect: rectOf(0, 0, 0, 0) })) }) }).resolveTrustedClickPoint(
      MACRO
    ),
    { x: 150, y: 220, source: 'recorded' }
  );
  check(
    `${L}: a detached response input is ignored`,
    withDoc({
      doc: fakeDoc({ response: responseInput(null), fallback: widgetEl({ tagName: 'DIV', rect: WIDGET }) })
    }).resolveTrustedClickPoint(null),
    { x: 130, y: 233, source: 'widget' }
  );

  const engine = withDoc({ doc: fakeDoc() });
  check(`${L}: checkbox sits 30px into a 300px widget`, engine.checkboxPointForRect(WIDGET), { x: 130, y: 233 });
  check(`${L}: narrow widget keeps the checkbox proportional`, engine.checkboxPointForRect(rectOf(50, 20, 160, 60)), {
    x: 79,
    y: 50
  });
  check(`${L}: a point on the widget edge counts as inside`, engine.pointInsideRect({ x: 100, y: 266 }, WIDGET), true);
  check(`${L}: a point outside the widget does not`, engine.pointInsideRect({ x: 99, y: 266 }, WIDGET), false);
});

// ---- click pacing --------------------------------------------------------------
console.log('\n== trusted click pacing ==\n');

{
  const pace = AUTOMATIONS.map((s) => {
    const e = loadEngine(s, {});
    return {
      label: s.label,
      settle: e.TRUSTED_CLICK_SETTLE_MS,
      gap: e.TRUSTED_CLICK_GAP_MS,
      max: e.TRUSTED_CLICK_MAX,
      focusAfter: e.TRUSTED_CLICK_FOCUS_AFTER,
      due: e.trustedClickDue
    };
  });

  check(
    'both scripts pace the clicks identically',
    [pace[0].settle, pace[0].gap, pace[0].max, pace[0].focusAfter],
    [pace[1].settle, pace[1].gap, pace[1].max, pace[1].focusAfter]
  );

  const p = pace[0];
  check('the widget gets a moment to render', p.settle > 0 && p.settle <= 1500, true);
  check('clicks are not spammed', p.gap >= 1500, true);
  check('the cap outlasts a stubborn widget', p.max >= 10, true);
  check('the human nudge comes early but after retrying', p.focusAfter >= 2 && p.focusAfter < p.max, true);

  check('no click while the widget is still rendering', p.due(0, 1000, 0, 1600), false);
  check('the first click fires right after the settle delay', p.due(0, 1000, 0, 1601), true);
  check('the check is not clicked twice inside one gap', p.due(1, 1000, 5000, 6500), false);
  check('the check is clicked again once the gap passed', p.due(1, 1000, 5000, 8001), true);
  check('clicking keeps going near the cap', p.due(p.max - 1, 1000, 0, 10 * 60 * 1000), true);
  check('clicking stops at the cap', p.due(p.max, 1000, 0, 10 * 60 * 1000), false);
  check('clicking stays stopped past the cap', p.due(p.max + 99, 1000, 0, 10 * 60 * 1000), false);
}

// ---- click dispatch ----------------------------------------------------------
(async function () {
  console.log('\n== Engine 2 dispatch ==\n');

  const spec = AUTOMATIONS[0];

  const sent = fakeChrome();
  check('click is sent to the background worker', await loadEngine(spec, { chrome: sent }).replayMacroEngine2(130, 233), true);
  check(
    'click payload requests the trusted CDP click',
    JSON.stringify(sent.sent[0]),
    JSON.stringify({ action: 'REPLAY_MACRO_CLICK', x: 130, y: 233 })
  );

  const refused = fakeChrome({ respond: () => ({ success: false, error: 'debugger busy' }) });
  check('a refused click resolves false', await loadEngine(spec, { chrome: refused }).replayMacroEngine2(130, 233), false);

  check(
    'a missing receiver resolves false instead of throwing',
    await loadEngine(spec, { chrome: fakeChrome({ throws: true }) }).replayMacroEngine2(130, 233),
    false
  );

  const doc = fakeDoc();
  loadEngine(spec, { doc }).showClickRipple(130, 233);
  check('ripple element created', doc.created.length, 1);
  check(
    'ripple is centred on the click point',
    doc.created[0].style.cssText.includes('left: 115px') && doc.created[0].style.cssText.includes('top: 218px'),
    true
  );
  check('ripple appended once', doc.appended.length, 1);
  ok('ripple dispatches no event', typeof doc.created[0].dispatchEvent === 'undefined');

  // ---- click timeline: settle -> click -> keep clicking -> tab surfaced ------
  console.log('\n== click timeline (driven through the real branch) ==\n');

  for (const spec of AUTOMATIONS) {
    const L = spec.label;
    const t = makeTimeline(spec);
    const GAP = t.pacing.TRUSTED_CLICK_GAP_MS;

    await t.advanceTo(1000); // the tick that detects the check
    check(`${L}: no click while the widget is still rendering`, t.calls.clicks.length, 0);

    await t.advanceTo(1700); // +700ms, just past the settle delay
    check(`${L}: first trusted click after the settle delay`, t.calls.clicks.length, 1);
    check(`${L}: click uses the resolved coordinates`, JSON.stringify(t.calls.clicks[0]), JSON.stringify({ x: 130, y: 233 }));

    await t.advanceTo(1700 + GAP - 200);
    check(`${L}: no duplicate click inside the gap`, t.calls.clicks.length, 1);
    check(`${L}: too early to surface the tab`, t.calls.focus, 0);

    // The check is still up, so the click is played again - and again.
    for (let attempt = 2; attempt <= 3; attempt++) {
      await t.advanceTo(t.clockNow() + GAP + 100);
      check(`${L}: trusted click ${attempt} while the check is still up`, t.calls.clicks.length, attempt);
      check(
        `${L}: click ${attempt} is measured again, not replayed`,
        JSON.stringify(t.calls.clicks[attempt - 1]),
        JSON.stringify({ x: 130, y: 233 })
      );
    }

    // A tick inside the gap: no click, but the tab is brought forward once.
    await t.advanceTo(t.clockNow() + 200);
    check(`${L}: no extra click inside the gap`, t.calls.clicks.length, 3);
    check(`${L}: the tab is surfaced after three attempts`, t.calls.focus, 1);

    await t.advanceTo(t.clockNow() + GAP + 100);
    check(`${L}: clicking continues after the tab was surfaced`, t.calls.clicks.length, 4);
    check(`${L}: the tab is not surfaced twice`, t.calls.focus, 1);
    check(`${L}: the attempts are counted`, t.state.challengeClicks, 4);
    check(`${L}: the run does not move on while the check is up`, t.calls.advance + t.calls.next, 0);

    // Turnstile solved (or the page navigated): nothing is clicked any more.
    t.setChallenge(false);
    await t.advanceTo(t.clockNow() + GAP * 4);
    check(`${L}: no clicks once the check page is gone`, t.calls.clicks.length, 4);
    check(`${L}: the tab is not surfaced again`, t.calls.focus, 1);

    if (spec.resetsInBranch) {
      check(
        `${L}: the challenge state is reset when the check clears`,
        [t.state.challengeClicks, t.state.challengeDetectedAt, t.state.challengeFocusAsked],
        [0, 0, false]
      );
    } else {
      check(`${L}: the branch leaves the counters alone`, t.state.challengeClicks, 4);
    }
  }

  // ---- the human cursor engine must stay gone --------------------------------
  console.log('\n== no human cursor engine left ==\n');

  AUTOMATIONS.forEach((s) => {
    const L = s.label;
    ok(`${L}: Engine 1 replay function is gone`, !/replayMacroEngine1/.test(s.src));
    ok(`${L}: no fake cursor element is injected`, !/macro-replay-cursor/.test(s.src));
    ok(`${L}: no synthetic events in the trusted click block`, !/dispatchEvent/.test(s.block));
    ok(`${L}: the recorded path is not replayed`, !/macro\.path/.test(s.src));
    ok(`${L}: the challenge branch dispatches the trusted click`, /replayMacroEngine2\(/.test(s.branch));
    ok(`${L}: the challenge branch never calls Engine 1`, !/replayMacroEngine1/.test(s.branch));
    ok(`${L}: the first click waits for the widget to render`, /trustedClickDue\(state\.challengeClicks/.test(s.branch));
    ok(`${L}: Engine 2 is not fired just once`, /trustedClickDue\(/.test(s.branch) && !/retryDue/.test(s.branch));
    ok(
      `${L}: the cap is handed to the pacing helper`,
      /TRUSTED_CLICK_MAX/.test(s.block) && s.branch.includes('TRUSTED_CLICK_MAX')
    );
    ok(
      `${L}: the tab is surfaced after a few attempts, not after every one`,
      /state\.challengeClicks >= TRUSTED_CLICK_FOCUS_AFTER/.test(s.branch) &&
        s.branch.indexOf('replayMacroEngine2(') < s.branch.lastIndexOf('focusThisTab()')
    );
    ok(`${L}: the per-site recording is read for the coordinates`, s.branch.includes(s.macroKey));
    ok(`${L}: the ripple marks where the click landed`, /if \(clicked\) showClickRipple/.test(s.branch));
    ok(`${L}: challenge state resets when the check clears`, /state\.challengeClicks = 0/.test(s.src) && /state\.challengeLastClickAt = 0/.test(s.src));
  });

  console.log(`\n=== TOTAL: ${passed} passed, ${failures.length} failed ===\n`);
  process.exit(failures.length === 0 ? 0 : 1);
})();