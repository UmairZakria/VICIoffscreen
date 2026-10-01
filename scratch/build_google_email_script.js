// Builds google_email_automation.js and google_gender_automation.js out of google_automation.js.
//
// The Google AI Mode jobs share everything that touches the page: the search box, typing the query,
// Enter, switching the results page into AI Mode, waiting for the answer to settle, and the whole
// search-history sweep (open the box's list, find the row that is ours, press its Delete control,
// refresh until the entry shows up). What differs is the question and the answer:
//
//   DOB     "{name} lives at {address} born in {year} in which month ? no rough guess accurate"
//   email   "{name} lives at {address} born in {year|Month year} any public available primary email .
//            gmail hotmail yahoo icloud are prefered"
//   gender  "{name} is male or female?"
//
// So the files are derived, not copied by hand: this script does the mechanical half (guard name,
// storage key, message names) and the answer reader of each is edited in place afterwards. Re-running
// it would overwrite those edits - it is kept as the record of how the files were derived.
//
// Usage: node scratch/build_google_email_script.js

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'google_automation.js');

// One entry per derived script: what it is called, and the names that have to differ from the DOB one.
//
// An existing file is NEVER overwritten unless `--force` is passed: the answer reader of each derived
// script is edited by hand after it is generated (that is the half a mechanical rename cannot do), and
// regenerating from the DOB source would quietly throw those edits away. The guard is here because that
// is exactly what happened once.
const FORCE = process.argv.includes('--force');
const VARIANTS = [
  {
    file: 'google_email_automation.js',
    replacements: [
      // One guard per script: every one of them is injected into every google.com frame.
      ['window.__googleAiAutomationLoaded', 'window.__googleEmailAutomationLoaded'],
      // One pending session per job, so neither can read the other's.
      ['var STORAGE_KEY = "google_pending_lookup";', 'var STORAGE_KEY = "google_email_pending_lookup";'],
      // The message names the background routes on.
      ['"GOOGLE_LOOKUP_PROGRESS"', '"GOOGLE_EMAIL_PROGRESS"'],
      ['"GOOGLE_DOB_RESULT"', '"GOOGLE_EMAIL_RESULT"'],
      ['"GOOGLE_DOB_NEXT_ADDRESS"', '"GOOGLE_EMAIL_NEXT_ADDRESS"']
    ]
  },
  {
    file: 'google_gender_automation.js',
    replacements: [
      ['window.__googleAiAutomationLoaded', 'window.__googleGenderAutomationLoaded'],
      ['var STORAGE_KEY = "google_pending_lookup";', 'var STORAGE_KEY = "google_gender_pending_lookup";'],
      ['"GOOGLE_LOOKUP_PROGRESS"', '"GOOGLE_GENDER_PROGRESS"'],
      ['"GOOGLE_DOB_RESULT"', '"GOOGLE_GENDER_RESULT"'],
      ['"GOOGLE_DOB_NEXT_ADDRESS"', '"GOOGLE_GENDER_NEXT_ADDRESS"']
    ]
  },
  {
    // The manual card's resolver: "{name} lives at {anything} what is the full address, email and
    // dob?" and, when that answers nothing, "... whats the full address?". Two queries, one after the
    // other, which is exactly the walk the DOB runner already does - so this is the same file again.
    file: 'google_address_automation.js',
    replacements: [
      ['window.__googleAiAutomationLoaded', 'window.__googleAddressAutomationLoaded'],
      ['var STORAGE_KEY = "google_pending_lookup";', 'var STORAGE_KEY = "google_address_pending_lookup";'],
      ['"GOOGLE_LOOKUP_PROGRESS"', '"GOOGLE_ADDRESS_PROGRESS"'],
      ['"GOOGLE_DOB_RESULT"', '"GOOGLE_ADDRESS_RESULT"'],
      ['"GOOGLE_DOB_NEXT_ADDRESS"', '"GOOGLE_ADDRESS_NEXT_ADDRESS"']
    ]
  }
];

for (const variant of VARIANTS) {
  const target = path.join(ROOT, variant.file);

  if (fs.existsSync(target) && !FORCE) {
    console.log(`[${variant.file}] already exists - left alone (pass --force to regenerate from scratch)`);
    continue;
  }

  let text = fs.readFileSync(SOURCE, 'utf8');

  for (const [from, to] of variant.replacements) {
    const before = text.split(from).length - 1;
    if (before === 0) {
      console.error(`[${variant.file}] MISSING (nothing replaced): ${from}`);
      process.exit(1);
    }
    text = text.split(from).join(to);
    console.log(`[${variant.file}] replaced ${before}x  ${from}`);
  }

  fs.writeFileSync(path.join(ROOT, variant.file), text);
  console.log(`[${variant.file}] wrote ${text.length} chars`);
}

