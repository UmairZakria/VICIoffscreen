// Regression harness for the "Settings & Calibration" recording cards.
// Run with:  node scratch/settings_recordings_test.js
//
// The sidebar block is sliced out of popup.js / window.js / widget.js and driven with a
// hand crafted DOM + chrome.storage fake, so the real shipped code is what gets tested:
//  - per-site cards render stats / empty state from recorded_macro_<target>
//  - the Delete button arms on first click and removes the macro on the second
//  - every element id the code asks for really exists in the markup files

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

let passed = 0;
const failures = [];
function check(name, actual, expected) {
  if (actual === expected) {
    passed++;
  } else {
    failures.push(name);
    console.log(`FAIL  ${name}\n        expected: ${JSON.stringify(expected)}\n        actual:   ${JSON.stringify(actual)}`);
  }
}
function ok(name, condition) {
  check(name, !!condition, true);
}

// ---- source slicing ---------------------------------------------------------
function slice(file, startMarker, endMarker) {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  const a = src.indexOf(startMarker);
  const b = src.indexOf(endMarker, a);
  if (a === -1 || b === -1) throw new Error(`Could not slice "${startMarker}" from ${file}`);
  return src.slice(a, b);
}

function browserFactory(file) {
  const block = slice(file, '  // Settings & Calibration Sidebar Logic', '  initSettingsSidebar();');
  return new Function('document', 'chrome', `${block}\n  return initSettingsSidebar;`);
}

function widgetFactory() {
  const block = slice('widget.js', '  // Settings & Calibration Sidebar Logic for In-Page Widget', '  initWidgetSettingsSidebar();');
  return new Function('shadow', 'chrome', `${block}\n  return initWidgetSettingsSidebar;`);
}

// ---- fake DOM ---------------------------------------------------------------
function makeEl(id) {
  const classes = new Set();
  const handlers = {};
  const span = { id: `${id}-label`, textContent: '' };
  return {
    id,
    textContent: '',
    title: '',
    disabled: false,
    dataset: {},
    _classes: classes,
    _span: span,
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
      toggle: (c, on) => {
        if (on === undefined) {
          classes.has(c) ? classes.delete(c) : classes.add(c);
        } else if (on) {
          classes.add(c);
        } else {
          classes.delete(c);
        }
        return classes.has(c);
      }
    },
    querySelector: (sel) => (sel === 'span' ? span : null),
    addEventListener: (ev, fn) => {
      handlers[ev] = fn;
    },
    click: () => handlers.click && handlers.click()
  };
}

function makeRegistry() {
  const els = new Map();
  const requested = [];
  return {
    requested,
    get(id) {
      requested.push(id);
      if (!els.has(id)) els.set(id, makeEl(id));
      return els.get(id);
    },
    el(id) {
      return els.get(id);
    }
  };
}

function makeChrome(store) {
  const sent = [];
  const listeners = [];
  return {
    sent,
    listeners,
    api: {
      storage: {
        local: {
          get: (keys, cb) => cb(Object.assign({}, store))
        }
      },
      runtime: {
        sendMessage: async (msg) => {
          sent.push(msg);
          return { success: true };
        },
        onMessage: {
          addListener: (fn) => listeners.push(fn)
        }
      }
    }
  };
}

const MACRO = {
  target: 'unmask',
  recordedAt: '2026-09-24T10:00:00.000Z',
  durationMs: 1750,
  pointCount: 42,
  avgSpeedPxPerSec: 910,
  click: { x: 120, y: 240, targetTag: 'DIV', targetId: 'cf-turnstile', targetClass: 'cf-turnstile-wrap', targetText: 'Verify' },
  path: [{ x: 1, y: 2 }]
};

function boot(build, docParam, store) {
  const reg = makeRegistry();
  const chromeFake = makeChrome(store);
  const init = build()(docParam(reg), chromeFake.api);
  init();
  return { reg, chrome: chromeFake, init };
}

function bootSidebar(file, store) {
  return boot(browserFactory.bind(null, file), (reg) => ({ getElementById: reg.get }), store);
}

function bootWidget(store) {
  return boot(widgetFactory, (reg) => ({ getElementById: reg.get }), store);
}

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function idsInMarkup(file) {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  const ids = new Set();
  const re = /id="([^"]+)"/g;
  let m;
  while ((m = re.exec(src))) ids.add(m[1]);
  return ids;
}

(async () => {
  // ---- 1. Cards render the saved macro --------------------------------------
  const savedStore = { recorded_macro_unmask: MACRO, last_macro_recording: MACRO };
  const s1 = bootSidebar('popup.js', savedStore);
  check('unmask badge recorded', s1.reg.el('badge-macro-unmask').textContent, 'Recorded');
  ok('unmask badge gets the saved style', s1.reg.el('badge-macro-unmask')._classes.has('saved'));
  ok('unmask stats visible', !s1.reg.el('stats-macro-unmask')._classes.has('hidden'));
  ok('unmask empty state hidden', s1.reg.el('empty-macro-unmask')._classes.has('hidden'));
  ok('unmask delete button visible', !s1.reg.el('btn-delete-unmask')._classes.has('hidden'));
  check('unmask duration', s1.reg.el('duration-macro-unmask').textContent, '1750 ms');
  check('unmask waypoints', s1.reg.el('points-macro-unmask').textContent, '42 pts');
  check('unmask avg speed', s1.reg.el('speed-macro-unmask').textContent, '910 px/s');
  check('unmask first click', s1.reg.el('click-macro-unmask').textContent, '(120, 240)');
  check('unmask target element', s1.reg.el('elem-macro-unmask').textContent, '<div#cf-turnstile.cf-turnstile-wrap>');
  check('unmask label offers re-record', s1.reg.el('label-record-unmask').textContent, 'Re-record');

  check('thatsthem badge not recorded', s1.reg.el('badge-macro-thatsthem').textContent, 'Not Recorded');
  ok('thatsthem stats hidden', s1.reg.el('stats-macro-thatsthem')._classes.has('hidden'));
  ok('thatsthem delete hidden', s1.reg.el('btn-delete-thatsthem')._classes.has('hidden'));
  check('thatsthem label default', s1.reg.el('label-record-thatsthem').textContent, 'Record ThatsThem');

  // ---- 2. Nothing saved yet --------------------------------------------------
  const s2 = bootSidebar('popup.js', {});
  check('empty store badge', s2.reg.el('badge-macro-unmask').textContent, 'Not Recorded');
  ok('empty store shows empty state', !s2.reg.el('empty-macro-unmask')._classes.has('hidden'));
  ok('empty store hides delete', s2.reg.el('btn-delete-unmask')._classes.has('hidden'));
  check('empty store label', s2.reg.el('label-record-unmask').textContent, 'Record Unmask');
  check('empty store time', s2.reg.el('time-macro-unmask').textContent, '--');

  // ---- 3. Legacy last_macro_recording fallback -------------------------------
  const s3 = bootSidebar('window.js', { last_macro_recording: { target: 'thatsthem', path: [{ x: 1, y: 1 }] } });
  check('legacy record lights up its own card', s3.reg.el('badge-macro-thatsthem').textContent, 'Recorded');
  check('legacy record leaves the other card empty', s3.reg.el('badge-macro-unmask').textContent, 'Not Recorded');
  const s3b = bootSidebar('window.js', { last_macro_recording: { target: 'unmask', path: [{ x: 1, y: 1 }] } });
  check('legacy record is not duplicated', s3b.reg.el('badge-macro-thatsthem').textContent, 'Not Recorded');

  // ---- 4. Delete: first click arms, second click removes ---------------------
  const s4 = bootSidebar('popup.js', { recorded_macro_unmask: MACRO, last_macro_recording: MACRO });
  const del4 = s4.reg.el('btn-delete-unmask');
  del4.click();
  check('first click arms the delete button', del4.dataset.armed, '1');
  check('first click relabels to Confirm?', del4._span.textContent, 'Confirm?');
  check('first click sends nothing to the worker', s4.chrome.sent.length, 0);
  del4.click();
  await tick();
  check('second click sends DELETE_MOUSE_RECORDING', s4.chrome.sent[0] && s4.chrome.sent[0].action, 'DELETE_MOUSE_RECORDING');
  check('delete targets the right site', s4.chrome.sent[0] && s4.chrome.sent[0].target, 'unmask');
  check('delete reports back in the status banner', s4.reg.el('rec-status-title').textContent, 'Unmask.com recording deleted');

  const s4b = bootSidebar('popup.js', { recorded_macro_thatsthem: MACRO });
  s4b.reg.el('btn-delete-thatsthem').click();
  s4b.reg.el('btn-delete-thatsthem').click();
  await tick();
  check('thatsthem delete targets thatsthem', s4b.chrome.sent[0] && s4b.chrome.sent[0].target, 'thatsthem');

  // ---- 5. Active recording banner + cancel ----------------------------------
  const s5 = bootSidebar('popup.js', { active_mouse_recording: { active: true, target: 'unmask' } });
  ok('cancel button visible while recording', !s5.reg.el('btn-cancel-recording')._classes.has('hidden'));
  check('recording status title', s5.reg.el('rec-status-title').textContent, 'Recording on Unmask.com...');
  s5.reg.el('btn-cancel-recording').click();
  await tick();
  check('cancel sends CANCEL_MOUSE_RECORDING', s5.chrome.sent[0] && s5.chrome.sent[0].action, 'CANCEL_MOUSE_RECORDING');
  ok('cancel button hidden when idle', bootSidebar('popup.js', {}).reg.el('btn-cancel-recording')._classes.has('hidden'));

  // ---- 6. Deletion broadcast from the worker refreshes the cards -------------
  const store6 = { recorded_macro_unmask: MACRO };
  const s6 = bootSidebar('window.js', store6);
  delete store6.recorded_macro_unmask;
  s6.chrome.listeners.forEach((fn) => fn({ action: 'MOUSE_RECORDING_DELETED', target: 'unmask' }));
  check('deleted broadcast empties the card', s6.reg.el('badge-macro-unmask').textContent, 'Not Recorded');
  ok('deleted broadcast hides the delete button', s6.reg.el('btn-delete-unmask')._classes.has('hidden'));
  s6.chrome.listeners.forEach((fn) => fn({ action: 'MOUSE_RECORDING_SAVED', target: 'unmask', result: MACRO }));
  check('saved broadcast restores the card', s6.reg.el('badge-macro-unmask').textContent, 'Not Recorded');

  // ---- 7. In-page widget behaves the same -----------------------------------
  const w = bootWidget({ recorded_macro_thatsthem: Object.assign({}, MACRO, { target: 'thatsthem' }) });
  check('widget badge recorded', w.reg.el('badge-macro-thatsthem').textContent, 'Recorded');
  ok('widget delete button visible', !w.reg.el('btn-delete-thatsthem')._classes.has('hidden'));
  w.reg.el('btn-delete-thatsthem').click();
  check('widget first click only arms', w.chrome.sent.length, 0);
  w.reg.el('btn-delete-thatsthem').click();
  await tick();
  check('widget delete targets thatsthem', w.chrome.sent[0] && w.chrome.sent[0].target, 'thatsthem');

  // ---- 8. Every element id the code asks for exists in the markup -----------
  const missing = (file, requested) => {
    const ids = idsInMarkup(file);
    return requested.filter((id) => !ids.has(id));
  };
  check('popup.js ids all exist in popup.html', missing('popup.html', [...new Set(s1.reg.requested)]).join(', '), '');
  check('window.js ids all exist in window.html', missing('window.html', [...new Set(s3.reg.requested)]).join(', '), '');
  check('widget.js ids all exist in widget markup', missing('widget.js', [...new Set(w.reg.requested)]).join(', '), '');

  console.log(`\n=== TOTAL: ${passed} passed, ${failures.length} failed ===\n`);
  process.exit(failures.length === 0 ? 0 : 1);
})();