// Regression harness for the Google search-history sweep in google_automation.js.
// Run with:  node scratch/google_history_delete_test.js
//
// The queries the DOB run types are Google search-history entries, and the box offers them straight
// back in its suggestion list. That list is the only place they can be taken out again:
//
//   <li class="sbct" data-attrid="AutocompletePrediction" data-entityname="<the query>">
//     <div class="AQZ9Vd" role="button" aria-label="Delete <the query> from search history">
//       <div class="sbai JCHpcb">Delete</div>          <- hidden until the row is hovered
//
// The list opens by itself after the query is typed, or on Ctrl+ArrowDown, or on a click in the box;
// the box says so with `aria-expanded="true"` and the rows are really rendered. The harness drives the
// shipped state machine through a fake clock and a fake DOM built from that markup.

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'google_automation.js');
const src = fs.readFileSync(SRC, 'utf8');

function slice(from, to) {
  const a = src.indexOf(from);
  const b = src.indexOf(to);
  if (a === -1 || b === -1 || b <= a) throw new Error(`Could not slice ${from} .. ${to}`);
  return src.slice(a, b);
}

// The timing constants, and everything from the session helpers down to the run itself.
const block =
  slice('var ANSWER_APPEAR_MS = 25000;', 'var FULL_MONTHS = [') +
  slice('var currentSession = null;', 'function runGoogleAutomation(session) {');

const mod = new Function(
  block +
    '\nreturn { suggestionBox, suggestionListOpen, visibleSuggestionRows, findSuggestionRows, suggestionText,' +
    ' findSuggestionRow, findRowByText, findRowByPrefix, sameText, isOwnQueryText, findSuggestionDelete, hoverSuggestionRow,' +
    ' pressControl, pressSuggestionDelete, controlEventInit, openSuggestionList, deleteHistoryEntry,' +
    ' nextOwnRow, historySweepFinished, armQuery, findSearchInput,' +
    ' LIST_OPEN_MAX_MS, DELETE_WAIT_MS, DELETE_RETRY_MS, HISTORY_MAX_DELETES, HISTORY_SWEEP_MAX_MS };'
)();

let passed = 0;
let failed = 0;

function check(label, actual, expected) {
  const ok = actual === expected;
  if (ok) passed++;
  else failed++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}\n      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(actual)}`
  );
}

function checkJson(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const good = a === e;
  if (good) passed++;
  else failed++;
  console.log(`${good ? 'PASS' : 'FAIL'}  ${label}\n      expected: ${e}\n      actual:   ${a}`);
}

function ok(label, value) {
  check(label, !!value, true);
}

// ---- the clock is ours, so a "wait" is a number ------------------------------------------------
let now = 1000000;
Date.now = () => now;
function advance(ms) {
  now += ms;
}

// ---- the DOM: the box, and the rows of the suggestion list -------------------------------------
const QUERY = 'Raymond Rodriguez lives at 211 River Rd, Channelview, TX 77530 born in 1964 in which month ? no rough guess accurate';
const STALE = 'Herman Smith lives at 5102 Kelso St, Houston, TX 77021 born in 1958 in which month ? no rough guess accurate';
const USER_SEARCH = 'cineby';

function eventLog() {
  return {
    events: [],
    keys: [],
    push(type, ev) {
      this.events.push(type);
      if (ev && ev.key) this.keys.push((ev.ctrlKey ? 'ctrl+' : '') + ev.key);
    }
  };
}

// One suggestion row: the delete wrapper (.AQZ9Vd) with the hidden "Delete" label (.sbai) inside it.
function suggestionRow(entity, opts) {
  opts = opts || {};
  const rowLog = eventLog();
  const controlLog = eventLog();
  const labelLog = eventLog();

  const control = {
    events: controlLog.events,
    getAttribute: (name) => (name === 'aria-label' ? `Delete ${entity} from search history` : null),
    getBoundingClientRect: () => ({ left: 10, top: 60, width: 40, height: 14 }),
    dispatchEvent: (ev) => (controlLog.push(ev.type, ev), true),
    click: () => (controlLog.events.push('click()'), undefined)
  };

  const label = {
    events: labelLog.events,
    getAttribute: () => null,
    getBoundingClientRect: () => ({ left: 20, top: 62, width: 30, height: 12 }),
    dispatchEvent: (ev) => (labelLog.push(ev.type, ev), true),
    click: () => (labelLog.events.push('click()'), undefined)
  };

  const row = {
    entity: entity,
    events: rowLog.events,
    classes: new Set(),
    getAttribute: (name) => (name === 'data-entityname' ? entity : null),
    getBoundingClientRect: () =>
      opts.hidden ? { left: 0, top: 0, width: 0, height: 0 } : { left: 0, top: 40, width: 600, height: 40 },
    querySelector: (sel) => {
      if (sel.indexOf('[role="button"]') === 0) return opts.noControl ? null : control;
      if (sel === '.AQZ9Vd') return opts.noControl ? null : control;
      if (sel === '.sbai') return opts.noControl ? null : label;
      if (sel.indexOf('[role="option"]') === 0) return { getAttribute: () => entity, textContent: entity };
      return null;
    },
    classList: { add: (c) => row.classes.add(c) },
    parentElement: null,
    textContent: entity,
    dispatchEvent: (ev) => (rowLog.push(ev.type, ev), true)
  };

  return { row: row, control: control, label: label };
}

function searchBox(expanded) {
  const boxLog = eventLog();
  const box = {
    events: boxLog.events,
    keys: boxLog.keys,
    value: '',
    expanded: expanded || 'false',
    getAttribute: (name) => (name === 'aria-expanded' ? box.expanded : null),
    setAttribute: (name, value) => {
      if (name === 'aria-expanded') box.expanded = value;
    },
    getBoundingClientRect: () => ({ left: 100, top: 10, width: 500, height: 44 }),
    focus: () => boxLog.events.push('focus'),
    dispatchEvent: (ev) => (boxLog.push(ev.type, ev), true),
    click: () => (boxLog.events.push('click()'), undefined),
    form: null
  };
  return box;
}

let rows = [];
let box = null;

// A page context: the module reaches for MouseEvent/PointerEvent through `window`, and for the plain
// constructors when it hovers a row or presses a control.
class FakeMouseEvent {
  constructor(type, opts) {
    this.type = type;
    this.bubbles = !!(opts && opts.bubbles);
    this.detail = (opts && opts.detail) || 0;
    this.clientX = (opts && opts.clientX) || 0;
  }
}
class FakeKeyboardEvent {
  constructor(type, opts) {
    this.type = type;
    this.key = (opts && opts.key) || '';
    this.ctrlKey = !!(opts && opts.ctrlKey);
    this.bubbles = !!(opts && opts.bubbles);
  }
}
globalThis.MouseEvent = FakeMouseEvent;
globalThis.KeyboardEvent = FakeKeyboardEvent;
globalThis.window = { MouseEvent: FakeMouseEvent, KeyboardEvent: FakeKeyboardEvent };
globalThis.document = {
  querySelectorAll: (sel) => (sel.indexOf('AutocompletePrediction') !== -1 ? rows.slice() : []),
  querySelector: (sel) => (sel.indexOf('textarea') !== -1 ? box : null),
  getElementById: () => null,
  body: { innerText: '' }
};

function state() {
  return {
    historyStep: '',
    historyStartedAt: 0,
    historyOpenedAt: 0,
    historyKeyedAt: 0,
    historyClickedAt: 0,
    historyRowText: '',
    historyPressedAt: 0,
    historyRetries: 0,
    historyDeleted: 0,
    historySkipped: 0,
    historyTried: []
  };
}


// ---------------------------------------------------------------------------
console.log('\n== 1. only this extension\'s searches are recognised ==\n');
// ---------------------------------------------------------------------------

const own = suggestionRow(QUERY);
const lookalike = suggestionRow(QUERY + ' please');
const user = suggestionRow(USER_SEARCH);
const stale = suggestionRow(STALE);
const hiddenRow = suggestionRow('something hidden', { hidden: true });

rows = [user.row, own.row, lookalike.row];
box = searchBox('true');

check('a rendered row means the list is open', mod.suggestionListOpen(box), true);
rows = [hiddenRow.row];
box = searchBox('true');
check('a row that is not laid out still counts when the box says the list is open', mod.suggestionListOpen(box), true);
box = searchBox('false');
check('a row that is not laid out and no attribute is not an open list', mod.suggestionListOpen(box), false);
box = searchBox('false');
rows = [own.row];
check('visible rows count even without the attribute', mod.suggestionListOpen(box), true);
box = searchBox('true');
rows = [];
check('an attribute with no rows in it is not an open list', mod.suggestionListOpen(box), false);

rows = [user.row, own.row, lookalike.row];
check('the row standing for exactly this query is the one found', mod.findSuggestionRow(QUERY), own.row);
check('a row that only contains the same words is not', mod.findSuggestionRow(QUERY + ' please') === lookalike.row, true);
check('case and whitespace are Google business, not ours', mod.sameText(QUERY.toUpperCase(), QUERY), true);
check('but a different string is a different search', mod.sameText(QUERY, QUERY + ' please'), false);
check('an empty query finds nothing', mod.findSuggestionRow(''), null);
check('a missing query finds nothing', mod.findSuggestionRow(null), null);
check('a query that is not in the list finds nothing', mod.findSuggestionRow('somebody else'), null);
check('the row string is data-entityname', mod.suggestionText(own.row), QUERY);
check('the opening of the query finds its row', mod.findRowByPrefix(QUERY) === own.row, true);
check(
  'a row stored with a trimmed tail is still found by its opening',
  mod.findRowByPrefix('Raymond Rodriguez lives at 211 River Rd, Channelview, TX 77530 bor') === own.row,
  true
);
check('a short query is not matched by its opening', mod.findRowByPrefix(USER_SEARCH), null);
check('and neither is a row that only shares a word', mod.findRowByPrefix('Herman Smith lives at 5102 Kelso St') === own.row, false);
check('a row of the extension is recognised by its shape', mod.isOwnQueryText(STALE), true);
check('the current run query is one of ours too', mod.isOwnQueryText(QUERY), true);
check('a user search is not', mod.isOwnQueryText(USER_SEARCH), false);
check('and neither is a user search that mentions people', mod.isOwnQueryText('herman smith phone number'), false);

const labelled = {
  getAttribute: () => null,
  querySelector: (sel) =>
    sel.indexOf('[role="option"]') === 0 ? { getAttribute: () => 'from the label', textContent: '' } : null,
  textContent: '  from   the label  '
};
check('without data-entityname the option label is used', mod.suggestionText(labelled), 'from the label');
check('the delete control is found by its label', mod.findSuggestionDelete(own.row), own.control);
rows = [suggestionRow(QUERY, { noControl: true }).row];
check('a row without a control yields nothing to click', mod.findSuggestionDelete(rows[0]), null);

// ---------------------------------------------------------------------------
console.log('\n== 2. the list is coaxed open, and given up on in bounded time ==\n');
// ---------------------------------------------------------------------------

// Nothing rendered at first - which is what a run sees when Google does not offer the list yet.
rows = [hiddenRow.row];
box = searchBox('false');
let run = state();

check('the box is asked for its list first', mod.deleteHistoryEntry(run, QUERY, box), true);
check('the run took the first step', run.historyStep, 'open');
ok('the box is clicked first - that is what renders the list', box.events.indexOf('click') !== -1 || box.events.indexOf('click()') !== -1);
check('nothing is pressed on the rows', hiddenRow.row.events.length, 0);

advance(800);
check('the run keeps waiting', mod.deleteHistoryEntry(run, QUERY, box), true);
check('Ctrl+ArrowDown follows the click', box.keys[0], 'ctrl+ArrowDown');

advance(700);
check('then the box is clicked once more', mod.deleteHistoryEntry(run, QUERY, box), true);

advance(mod.LIST_OPEN_MAX_MS);
check('a list that never opens is given up on', mod.deleteHistoryEntry(run, QUERY, box), false);
check('and the run says so instead of failing silently', run.historyStep, 'done');
check('nothing was deleted', hiddenRow.control.events.length, 0);
check('a finished sweep costs nothing more', mod.deleteHistoryEntry(run, QUERY, box), false);

// ---------------------------------------------------------------------------
console.log('\n== 3. the run\'s own entry is hovered, clicked and removed ==\n');
// ---------------------------------------------------------------------------

rows = [user.row, own.row];
box = searchBox('true');
own.row.events.length = 0;
own.control.events.length = 0;
own.label.events.length = 0;
user.row.events.length = 0;
run = state();

check('the search begins by asking for the list', mod.deleteHistoryEntry(run, QUERY, box), true);
check('the open list moves the run to the row', mod.deleteHistoryEntry(run, QUERY, box) && run.historyStep, 'pick');
advance(400);
check('the row is hovered and clicked', mod.deleteHistoryEntry(run, QUERY, box), true);
check('the run now waits for the row to go', run.historyStep, 'confirm');
checkJson('the row was hovered before it was clicked', own.row.events.slice(0, 3), ['mouseover', 'mouseenter', 'mousemove']);
check('the hover class Google CSS keys on was set', own.row.classes.has('sbhl'), true);
ok('the hidden "Delete" label was pressed first', own.label.events.indexOf('click') !== -1);
ok('the wrapper that carries the jsaction was pressed too', own.control.events.indexOf('click') !== -1);
ok('the press was a pointer/mouse sequence', own.control.events.indexOf('pointerdown') !== -1 && own.control.events.indexOf('mouseup') !== -1);
check('the row that is not ours was never touched', user.row.events.length, 0);
check('and its control neither', user.control.events.length, 0);

// The click works: Google drops the row from the list.
rows = [user.row];
advance(300);
check('the run noticed the row is gone and finished', mod.deleteHistoryEntry(run, QUERY, box), false);
check('the removal was counted', run.historyDeleted, 1);
check('nothing was left alone', run.historySkipped, 0);
check('and the box is free for the search', run.historyStep, 'done');
check('the user search is still in the list', mod.findSuggestionRow(USER_SEARCH) === user.row, true);
check('a finished sweep costs nothing more', mod.deleteHistoryEntry(run, QUERY, box), false);

// ---------------------------------------------------------------------------
console.log('\n== 4. stale entries from earlier runs are swept up as well ==\n');
// ---------------------------------------------------------------------------

rows = [user.row, stale.row, lookalike.row, own.row];
box = searchBox('true');
run = state();
for (const node of [user, stale, lookalike, own]) {
  node.row.events.length = 0;
  node.control.events.length = 0;
}

// The sweep runs on the tick: pick a row, click its Delete, wait for it to go, pick the next one.
// The list is re-read every time, because Google re-renders it after each deletion.
function sweepTicks(stateRef, boxRef, limit) {
  const gone = [];
  for (let i = 0; i < (limit || 12); i++) {
    if (!mod.deleteHistoryEntry(stateRef, QUERY, boxRef)) return gone;
    const row = stateRef.historyRowText ? mod.findRowByText(stateRef.historyRowText) : null;
    if (row && !gone.includes(stateRef.historyRowText)) {
      gone.push(stateRef.historyRowText);
      rows = rows.filter((r) => r !== row); // Google removes the row
    }
    advance(300);
  }
  return gone;
}

const removedRows = sweepTicks(run, box, 16);
checkJson(
  'this run\'s query went first, then its variant, then the stale entry',
  removedRows,
  [QUERY, QUERY + ' please', STALE]
);
check('all three were counted', run.historyDeleted, 3);
check('and the sweep finished', run.historyStep, 'done');
check('the user search was never clicked', user.control.events.length, 0);
check('the user search is still in the list', rows.length, 1);
check('and it is the only row left', rows[0] === user.row, true);

// ---------------------------------------------------------------------------
console.log('\n== 5. a click Google ignores is retried, then reported ==\n');
// ---------------------------------------------------------------------------

rows = [own.row];
box = searchBox('true');
own.control.events.length = 0;
run = state();

mod.deleteHistoryEntry(run, QUERY, box); // ask for the list
mod.deleteHistoryEntry(run, QUERY, box); // open list -> go to the row
mod.deleteHistoryEntry(run, QUERY, box); // hover + click
ok('the control was clicked once', own.control.events.indexOf('click') !== -1);
const afterFirstPress = own.control.events.length;
const pressesAtStart = own.control.events.filter((t) => t === 'click').length;

let ticks = 0;
advance(400);
while (mod.deleteHistoryEntry(run, QUERY, box) && ticks < 25) {
  ticks++;
  advance(400);
}

ok('the click was repeated', own.control.events.filter((t) => t === 'click').length > pressesAtStart);
ok('but not forever (' + ticks + ' ticks)', ticks < 25);
checkJson('the row was counted as skipped, not deleted', [run.historyDeleted, run.historySkipped], [0, 1]);
check('and the run says what happened', run.historyStep, 'done');
ok('the row is still in the list', mod.findSuggestionRow(QUERY) === own.row);
check('a press that was ignored is visible in the event log', afterFirstPress > 0, true);



// ---------------------------------------------------------------------------
console.log('\n== 6. the sweep is wired in before the search is submitted ==\n');
// ---------------------------------------------------------------------------

const code = src
  .split('\n')
  .filter((line) => !/^\s*\/\//.test(line))
  .join('\n');

const typedAt = code.indexOf('if (!typeQuery(query)) return;');
const cleanedAt = code.indexOf('deleteHistoryEntry(state, query, suggestionBox())');
const armedAt = code.indexOf('armQuery(query);');
const enteredAt = code.indexOf('pressEnter(findSearchInput());');

ok('the query is typed first', typedAt !== -1);
ok('the history sweep runs after typing', cleanedAt > typedAt);
ok('the box is re-armed after the sweep', armedAt > cleanedAt);
ok('and only then is Enter pressed', enteredAt > armedAt);
check(
  'the sweep is asked to finish before the search moves on',
  /if \(state\.homeStep === 1 && deleteHistoryEntry\(state, query, suggestionBox\(\)\)\) return;/.test(code),
  true
);

ok('the box is looked up as the combobox', /textarea\[name="q"\]\[role="combobox"\]/.test(code));
ok('the list state is read from the box', /getAttribute\("aria-expanded"\)/.test(code));
ok('rendered rows count as an open list', /visibleSuggestionRows\(\)\.length > 0/.test(code));
ok('the row is matched on data-entityname', /data-entityname/.test(code));
ok('the control is matched by its Delete label', /\[role="button"\]\[aria-label\^="Delete"\]/.test(code));
ok('the wrapper and the hidden label are the fallbacks', /\.AQZ9Vd/.test(code) && /\.sbai/.test(code));
ok('both the label and the wrapper are pressed', /function pressSuggestionDelete\(row, control\)/.test(code));
ok('the hover class Google CSS keys on is set', /classList\.add\("sbhl"\)/.test(code));
ok('the click is a pointer/mouse sequence', /\["pointerdown", "PointerEvent"\]/.test(code) && /\["click", "MouseEvent"\]/.test(code));
ok('the click carries a real button, detail and coordinates', /detail: 1/.test(code) && /clientX/.test(code));
ok('Ctrl+ArrowDown is what opens the list', /key: "ArrowDown"/.test(code) && /ctrlKey: true/.test(code));
ok('a click in the box is the second way', /pressControl\(input\)/.test(code));
ok('Escape closes the list before submitting', /key: "Escape"/.test(code));
ok('the sweep is bounded in rows and in time', mod.HISTORY_MAX_DELETES > 0 && mod.HISTORY_SWEEP_MAX_MS > 0);
check('the whole sweep fits inside the homepage budget', mod.HISTORY_SWEEP_MAX_MS <= 8000, true);
check(
  'the list is given a couple of seconds at most',
  mod.LIST_OPEN_MAX_MS >= 1000 && mod.LIST_OPEN_MAX_MS <= 3000,
  true
);
ok('the sweep never fails silently', /did not open - the search history was left as it is/.test(src));
// The wording is de-branded ("from the search history"), so this checks that the run reports what it
// removed rather than pinning the brand it was removed from.
ok('and it reports what it removed', /"Removed " \+ removed \+[\s\S]{0,120}history\./.test(src));
ok('the stale entries of earlier runs are swept too', /stale entry an earlier run left behind/.test(src));
ok(
  'the run never reaches for CDP or a trusted click',
  !/Input\.dispatchMouseEvent|chrome\.debugger|debugger\.attach/.test(src)
);
ok('the sweep runs on the tick, not on a sleep', !/await sleep/.test(code.slice(cleanedAt - 2000, cleanedAt + 2000)));

// armorQuery hands the box back to the run: Google may have cleared it while its list was open.
box = searchBox('true');
box.value = '';
mod.armQuery(QUERY);
check('the typed query is written back into the box', box.value, QUERY);
ok('Escape was pressed to close the list first', box.keys.indexOf('Escape') !== -1);
ok('the re-armed value is announced to the page', box.events.indexOf('input') !== -1 && box.events.indexOf('change') !== -1);

box = searchBox('true');
box.value = QUERY;
const beforeKeys = box.events.length;
mod.armQuery(QUERY);
check('a box that still holds the query is left alone', box.events.length - beforeKeys, 1);

console.log(`\n=== TOTAL: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);

