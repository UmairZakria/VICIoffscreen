// Regression harness for the "Settings & Calibration" toggles that replaced the cursor recorder.
// Run with:  node scratch/settings_toggles_test.js
//
// The real shipped code is what gets tested: the settings block is sliced out of popup.js / window.js /
// widget.js / background.js and driven with a hand-crafted DOM + chrome.storage fake, and the markup
// files are parsed to prove the panel really offers the switches the code reads.
//  - every switch defaults to on, so an install that never opens the panel behaves as it always has
//  - a stored "off" is honoured, and flipping a switch persists it under one key
//  - the background searches only the records that are on, and never falls back to a DOB source
//    the user has turned off
//  - the cursor recorder is gone: no script, no manifest entry, no messages

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

const SETTING_KEYS = [
  'records.record1',
  'records.record2',
  'dob.unmask',
  'dob.thatsthem',
  'dob.ai',
  'dnc.record1',
  'dnc.record2'
];

// ---- source slicing ---------------------------------------------------------
function slice(file, startMarker, endMarker) {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  const a = src.indexOf(startMarker);
  const b = src.indexOf(endMarker, a);
  if (a === -1 || b === -1) throw new Error(`Could not slice "${startMarker}" from ${file}`);
  return src.slice(a, b);
}

function settingsBlock(file) {
  const end = file === 'widget.js' ? '  initWidgetSettingsSidebar();' : '  initSettingsSidebar();';
  return slice(file, '// Run-time settings (Settings & Calibration panel)', end);
}

function browserFactory(file) {
  const block = settingsBlock(file);
  const tail = file === 'widget.js'
    ? '\n  return { init: initWidgetSettingsSidebar, settingValue, normalizeAutomationSettings, recordLabel, rideLabel };'
    : '\n  return { init: initSettingsSidebar, settingValue, normalizeAutomationSettings, recordLabel, rideLabel };';
  return new Function('document', 'shadow', 'chrome', block + tail);
}

function backgroundFactory() {
  const block = slice(
    'background.js',
    '// Run-time settings (Settings & Calibration panel)',
    '// Pre-warm the background runners immediately on extension install or startup'
  );
  return new Function(
    'chrome',
    `${block}\n  return { normalizeAutomationSettings, settingValue, enabledRecordSources, dobSourcesFromSettings, recordKey, recordLabel, rideLabel };`
  );
}

// ---- fake DOM ---------------------------------------------------------------
function classListOf(set) {
  return {
    add: (c) => set.add(c),
    remove: (c) => set.delete(c),
    contains: (c) => set.has(c),
    toggle: (c, on) => {
      if (on === undefined) {
        set.has(c) ? set.delete(c) : set.add(c);
      } else if (on) {
        set.add(c);
      } else {
        set.delete(c);
      }
      return set.has(c);
    }
  };
}

// One `.setting-row`: the checkbox the code reads plus the row it paints.
function makeToggleRow(key) {
  const rowClasses = new Set();
  const row = { _classes: rowClasses, classList: classListOf(rowClasses) };
  const input = {
    dataset: { setting: key },
    checked: false,
    _handlers: {},
    addEventListener(ev, fn) {
      this._handlers[ev] = fn;
    },
    closest: (sel) => (sel === '.setting-row' ? row : null),
    // What a real click on the switch does: flip the value, then fire change.
    flip() {
      this.checked = !this.checked;
      if (this._handlers.change) this._handlers.change();
    }
  };
  row._input = input;
  return row;
}

function makePanel(rows) {
  const classes = new Set(['closed']);
  const handlers = {};
  return {
    _classes: classes,
    _rows: rows,
    classList: classListOf(classes),
    querySelectorAll: (sel) => (sel === '.setting-toggle' ? rows.map((r) => r._input) : []),
    addEventListener: (ev, fn) => {
      handlers[ev] = fn;
    },
    click: () => handlers.click && handlers.click()
  };
}

function bootPanel(file, stored) {
  const rows = SETTING_KEYS.map(makeToggleRow);
  const panel = makePanel(rows);
  const toggleHandlers = {};
  const closeBtn = makePanel([]);
  const backdrop = makePanel([]);
  const map = {
    'settings-toggle-btn': {
      addEventListener: (ev, fn) => {
        toggleHandlers[ev] = fn;
      },
      click: () => toggleHandlers.click && toggleHandlers.click()
    },
    'settings-sidebar': panel,
    'close-sidebar-btn': closeBtn,
    'sidebar-backdrop': backdrop
  };

  const writes = [];
  const changeListeners = [];
  const chrome = {
    storage: {
      local: {
        get: (keys, cb) => {
          const out = {};
          (Array.isArray(keys) ? keys : [keys]).forEach((k) => {
            if (Object.prototype.hasOwnProperty.call(stored, k)) out[k] = stored[k];
          });
          cb(out);
        },
        set: (obj, cb) => {
          writes.push(obj);
          Object.keys(obj).forEach((k) => {
            stored[k] = obj[k];
          });
          if (cb) cb();
        }
      },
      onChanged: {
        addListener: (fn) => changeListeners.push(fn)
      }
    }
  };

  const build = browserFactory(file);
  // popup.js / window.js ask `document`, the widget asks `shadow`.
  const api = file === 'widget.js'
    ? build(null, { getElementById: (id) => map[id] }, chrome)
    : build({ getElementById: (id) => map[id] }, null, chrome);
  api.init();

  return {
    rows,
    panel,
    backdrop,
    closeBtn,
    toggleBtn: map['settings-toggle-btn'],
    writes,
    changeListeners,
    api,
    stored
  };
}

function idsInMarkup(file) {
  const src = readSource(file);
  const ids = new Set();
  const re = /id="([^"]+)"/g;
  let m;
  while ((m = re.exec(src))) ids.add(m[1]);
  return ids;
}

function settingKeysInMarkup(file) {
  const src = readSource(file);
  const keys = [];
  const re = /data-setting="([^"]+)"/g;
  let m;
  while ((m = re.exec(src))) keys.push(m[1]);
  return keys;
}

function readSource(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

const byKey = (panel, key) => panel.rows.find((r) => r._input.dataset.setting === key);
// A click on the switch itself: flips the value and fires `change`.
const flip = (panel, key) => byKey(panel, key)._input.flip();

(async () => {
  // ---- 1. Every switch is on until the user says otherwise -------------------
  const p1 = bootPanel('popup.js', {});
  check('all switches default to on', p1.rows.filter((r) => r._input.checked).length, SETTING_KEYS.length);
  check('no row is painted as off by default', p1.rows.filter((r) => r._classes.has('off')).length, 0);

  // ---- 2. A stored "off" is honoured ----------------------------------------
  const p2 = bootPanel('window.js', {
    automation_settings: { records: { record2: false }, dnc: { record1: false } }
  });
  check('records.record2 off is honoured', byKey(p2, 'records.record2')._input.checked, false);
  ok('records.record2 row is painted as off', byKey(p2, 'records.record2')._classes.has('off'));
  check('records.record1 stays on', byKey(p2, 'records.record1')._input.checked, true);
  check('dnc.record1 off is honoured', byKey(p2, 'dnc.record1')._input.checked, false);
  ok('dnc.record2 stays on', byKey(p2, 'dnc.record2')._input.checked);

  // ---- 3. An older / half-written value cannot read as "off" ----------------
  const p3 = bootPanel('popup.js', { automation_settings: { dob: {} } });
  check('an empty group defaults to on', p3.rows.filter((r) => r._input.checked).length, SETTING_KEYS.length);
  const p3b = bootPanel('popup.js', { automation_settings: 'nonsense' });
  check('a junk value defaults to on', p3b.rows.filter((r) => r._input.checked).length, SETTING_KEYS.length);

  // ---- 4. Flipping a switch persists it under one key -----------------------
  const p4 = bootPanel('popup.js', {});
  flip(p4, 'dob.ai');
  check('one flip is one write', p4.writes.length, 1);
  const written = p4.writes[0].automation_settings;
  ok('written under automation_settings', !!written);
  check('the flipped switch is off', written.dob.ai, false);
  check('the other switches are untouched', JSON.stringify(written.records), JSON.stringify({ record1: true, record2: true }));
  ok('the flipped row is painted as off', byKey(p4, 'dob.ai')._classes.has('off'));
  flip(p4, 'dob.ai');
  check('flipping back is on again', p4.writes[1].automation_settings.dob.ai, true);
  ok('the row follows the switch back', !byKey(p4, 'dob.ai')._classes.has('off'));

  // ---- 5. The panel opens and closes ---------------------------------------
  const p5 = bootPanel('window.js', {});
  ok('starts closed', p5.panel._classes.has('closed'));
  p5.toggleBtn.click();
  ok('opens on a click', !p5.panel._classes.has('closed'));
  ok('backdrop becomes visible', p5.backdrop._classes.has('visible'));
  p5.toggleBtn.click();
  ok('closes on the next click', p5.panel._classes.has('closed'));
  ok('backdrop is hidden again', !p5.backdrop._classes.has('visible'));

  // ---- 6. A switch flipped in another panel is picked up -------------------
  const p6 = bootPanel('popup.js', {});
  // What another panel's write looks like from here: storage changes, then the change event fires.
  const otherPanel = { records: { record1: false, record2: true } };
  p6.stored.automation_settings = otherPanel;
  p6.changeListeners.forEach((fn) => fn({ automation_settings: { newValue: otherPanel } }, 'local'));
  check('a storage change repaints the switch', byKey(p6, 'records.record1')._input.checked, false);
  ok('a storage change repaints the row', byKey(p6, 'records.record1')._classes.has('off'));

  // ---- 7. The in-page widget behaves the same ------------------------------
  const w = bootPanel('widget.js', { automation_settings: { dob: { thatsthem: false } } });
  check('widget honours a stored off', byKey(w, 'dob.thatsthem')._input.checked, false);
  check('widget has every switch', w.rows.length, SETTING_KEYS.length);
  flip(w, 'dnc.record2');
  check('widget writes the same key', w.writes[0].automation_settings.dnc.record2, false);

  // ---- 8. Every panel offers exactly these switches ------------------------
  ['popup.html', 'window.html', 'widget.js'].forEach((file) => {
    check(`${file} offers every switch`, settingKeysInMarkup(file).join(','), SETTING_KEYS.join(','));
  });

  // ---- 9. The source names stay out of the UI ------------------------------
  ['popup.html', 'window.html', 'widget.js'].forEach((file) => {
    const src = readSource(file);
    ok(`${file} says Record 1`, src.includes('>Record 1<'));
    ok(`${file} says Record 2`, src.includes('>Record 2<'));
    ok(`${file} has no lookup domain in markup`, !src.includes('>infolookup.site<') && !src.includes('>infolookupp.com<'));
  });
  ['popup.html', 'window.html'].forEach((file) => {
    const src = readSource(file);
    ok(`${file} says Ride 1`, src.includes('>Ride 1<'));
    ok(`${file} says Ride 2`, src.includes('>Ride 2<'));
    ok(`${file} names no provider`, !src.includes('>Amica<') && !src.includes('>Mercury<'));
  });
  const widgetSrc = readSource('widget.js');
  ok('widget rides are labelled, not named', widgetSrc.includes('${rideLabel("amica")}') && !widgetSrc.includes('>Amica</button>'));

  // ---- 10. The background reads the same settings --------------------------
  const bg = backgroundFactory()({});
  const defaults = bg.normalizeAutomationSettings(null);
  check('both records are searched by default', bg.enabledRecordSources(defaults).join(','), 'infolookup.site,infolookupp.com');
  check(
    'a record switched off is not searched',
    bg.enabledRecordSources({ records: { record2: false } }).join(','),
    'infolookup.site'
  );
  check('a record switched off reads as off', bg.settingValue({ records: { record2: false } }, 'records.record2'), false);
  check('a missing record reads as on', bg.settingValue({ records: {} }, 'records.record2'), true);
  check(
    'the DOB platforms are read as a set',
    JSON.stringify(bg.dobSourcesFromSettings({ dob: { unmask: false, ai: false } })),
    JSON.stringify({ unmask: false, thatsthem: true, ai: false })
  );
  check('record keys map to settings keys', bg.recordKey('infolookup.site') + ',' + bg.recordKey('infolookupp.com'), 'record1,record2');
  check('records are labelled, not named', bg.recordLabel('infolookup.site') + '/' + bg.recordLabel('infolookupp.com'), 'Record 1/Record 2');
  check('rides are labelled, not named', bg.rideLabel('amica') + '/' + bg.rideLabel('mercury'), 'Ride 1/Ride 2');

  // ---- 11. The background really gates on them -----------------------------
  const bgSrc = readSource('background.js');
  ok('records are dispatched from the settings', bgSrc.includes('for (const source of recordSources) {'));
  ok('no unconditional dispatch is left', !bgSrc.includes("dispatchToWorker('infolookup.site', phoneNumber, searchId);"));
  ok('completion waits for the enabled records', bgSrc.includes('expectedSources: recordSources.length'));
  ok('thatsthem is gated as a fallback', bgSrc.includes('if (session && session.allowThatsThem === false) {'));
  ok('a run with unmask off starts on thatsthem', bgSrc.includes('session.allowUnmask === false'));
  ok('the DOB platforms come from the settings', bgSrc.includes('const sources = dobSourcesFromSettings(settings);'));

  // ---- 12. The cursor recorder is gone -------------------------------------
  ok('recorder.js is deleted', !fs.existsSync(path.join(root, 'recorder.js')));
  const manifest = readSource('manifest.json');
  ok('the manifest has no recorder script', !manifest.includes('recorder.js'));
  const allSrc = ['background.js', 'widget.js', 'popup.js', 'window.js', 'content.js'].map(readSource).join('\n');
  ok('no recorder messages are handled', !/MOUSE_RECORDING|START_MOUSE_RECORDING|recorded_macro/.test(allSrc));

  // ---- 13. Every element id the panel asks for exists in its markup --------
  ['popup.js', 'window.js'].forEach((file) => {
    const html = file.replace('.js', '.html');
    const ids = idsInMarkup(html);
    const wanted = ['settings-toggle-btn', 'settings-sidebar', 'close-sidebar-btn', 'sidebar-backdrop'];
    check(`${file} ids all exist in ${html}`, wanted.filter((id) => !ids.has(id)).join(', '), '');
  });
  const widgetIds = idsInMarkup('widget.js');
  check(
    'widget ids all exist in its markup',
    ['settings-toggle-btn', 'settings-sidebar', 'close-sidebar-btn'].filter((id) => !widgetIds.has(id)).join(', '),
    ''
  );

  console.log(`\n=== TOTAL: ${passed} passed, ${failures.length} failed ===\n`);
  process.exit(failures.length === 0 ? 0 : 1);
})();

