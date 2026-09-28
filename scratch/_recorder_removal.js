// One-shot helper: remove the cursor/mouse-recording feature that the Settings toggles replaced.
// Run: node scratch/_recorder_removal.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function edit(file, replacements) {
  const full = path.join(root, file);
  let text = fs.readFileSync(full, 'utf8');
  replacements.forEach(([from, to]) => {
    if (!text.includes(from)) throw new Error(`${file}: pattern not found -> ${from.slice(0, 60)}`);
    if (text.split(from).length !== 2) throw new Error(`${file}: pattern is not unique -> ${from.slice(0, 60)}`);
    text = text.replace(from, to);
  });
  fs.writeFileSync(full, text, 'utf8');
  console.log(`${file}: ok`);
}

// ---------------------------------------------------------------- background.js
const bg = path.join(root, 'background.js');
let bgText = fs.readFileSync(bg, 'utf8');
const bgEol = bgText.indexOf('\r\n') >= 0 ? '\r\n' : '\n';
let bgLines = bgText.split(/\r?\n/);

// The five recorder actions, out of the message router.
const routerStart = bgLines.findIndex((l) => l.includes('// Mouse movement & click recording automation'));
const routerEnd = bgLines.findIndex((l, n) => n > routerStart && l.trim() === '});');
if (routerStart < 0 || routerEnd < 0) throw new Error('background.js: recorder router block not found');
bgLines.splice(routerStart, routerEnd - routerStart);

// The tab bookkeeping that only the recorder used.
const tabState = bgLines.findIndex((l) => l.includes('let activeMouseRecordingTabId = null;'));
if (tabState < 0) throw new Error('background.js: activeMouseRecordingTabId not found');
const onRemovedStart = bgLines.findIndex((l) => l.includes('if (activeMouseRecordingTabId && activeMouseRecordingTabId === tabId)'));
const onRemovedEnd = bgLines.findIndex((l, n) => n > onRemovedStart && l.trim() === '}' && bgLines[n + 1] !== undefined && bgLines[n + 1].trim() === '});');
if (onRemovedStart < 0 || onRemovedEnd < 0) throw new Error('background.js: onRemoved recorder block not found');
bgLines.splice(onRemovedStart, onRemovedEnd - onRemovedStart + 1);
// ...and the `let`, plus the blank line it left behind.
const tabStateAgain = bgLines.findIndex((l) => l.includes('let activeMouseRecordingTabId = null;'));
bgLines.splice(tabStateAgain, 2);

// The four handlers themselves.
const handlersStart = bgLines.findIndex((l) => l.includes('async function handleStartMouseRecording(target, sender, sendResponse) {'));
const authAnchor = bgLines.findIndex((l) => l.includes("const DEFAULT_AUTH_API = 'https://auto-lookup-portal.vercel.app';"));
if (handlersStart < 0 || authAnchor < 0) throw new Error('background.js: recorder handlers not found');
bgLines.splice(handlersStart, authAnchor - 1 - handlersStart);

bgText = bgLines.join(bgEol);
fs.writeFileSync(bg, bgText, 'utf8');
console.log('background.js: recorder plumbing removed');

// ---------------------------------------------------------------- the guards in the sites' scripts
edit('thatsthem_automation.js', [[
  '    chrome.storage.local.get([SESSION_KEY, "active_mouse_recording"], function (res) {\n' +
  '      if (res && res.active_mouse_recording && res.active_mouse_recording.active) {\n' +
  '        // Mouse recording is active on this tab - do not run search automation\n' +
  '        return;\n' +
  '      }\n' +
  '      var session = res ? res[SESSION_KEY] : null;\n',
  '    chrome.storage.local.get([SESSION_KEY], function (res) {\n' +
  '      var session = res ? res[SESSION_KEY] : null;\n'
]]);

edit('unmask_automation.js', [[
  '    chrome.storage.local.get(["unmask_pending_lookup", "active_mouse_recording"], function (res) {\n' +
  '      if (res && res.active_mouse_recording && res.active_mouse_recording.active) {\n' +
  '        // Mouse recording is active on this tab - do not run search automation\n' +
  '        return;\n' +
  '      }\n' +
  '      var session = res ? res.unmask_pending_lookup : null;\n',
  '    chrome.storage.local.get(["unmask_pending_lookup"], function (res) {\n' +
  '      var session = res ? res.unmask_pending_lookup : null;\n'
]]);

edit('google_automation.js', [[
  '    chrome.storage.local.get([STORAGE_KEY, "active_mouse_recording"], function (res) {\n' +
  '      if (res && res.active_mouse_recording && res.active_mouse_recording.active) return;\n' +
  '      var session = res ? res[STORAGE_KEY] : null;\n',
  '    chrome.storage.local.get([STORAGE_KEY], function (res) {\n' +
  '      var session = res ? res[STORAGE_KEY] : null;\n'
]]);

// ---------------------------------------------------------------- the recorder content script
edit('manifest.json', [[
  '    {\n' +
  '      "matches": [\n' +
  '        "<all_urls>"\n' +
  '      ],\n' +
  '      "js": [\n' +
  '        "recorder.js"\n' +
  '      ],\n' +
  '      "all_frames": true,\n' +
  '      "match_about_blank": true,\n' +
  '      "run_at": "document_start"\n' +
  '    },\n',
  ''
]]);

fs.unlinkSync(path.join(root, 'recorder.js'));
console.log('recorder.js: deleted');

// ---------------------------------------------------------------- stale comments
edit('widget.js', [['  <!-- Settings & Recording Sidebar Drawer -->', '  <!-- Settings Sidebar Drawer -->']]);
edit('popup.html', [['  <!-- Settings & Recording Sidebar Drawer -->', '  <!-- Settings Sidebar Drawer -->']]);
edit('window.html', [['  <!-- Settings & Recording Sidebar Drawer -->', '  <!-- Settings Sidebar Drawer -->']]);
