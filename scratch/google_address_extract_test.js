// Checks the manual card's resolver reader against the two real Google AI Mode answers it was built
// from - one that answers with labelled rows, one that answers with the address as its own lines.
//
// Usage: node scratch/google_address_extract_test.js
//
// The reader is lifted straight out of google_address_automation.js, so what is tested is the shipping
// code rather than a copy of it.

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'google_address_automation.js'), 'utf8');

const start = src.indexOf('var STREET_WORD_RE');
const end = src.indexOf('// ------------------------------------------------------------- removing the search-history entry');
if (start < 0 || end < 0) throw new Error('could not slice the reader out of the script');
const api = new Function(
  src.slice(start, end) + '\nreturn { extractAddressRecord: extractAddressRecord };'
)();

let failures = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}\n        got  ${JSON.stringify(got)}`);
}

// 1. "…what is the full address, email and dob?" answered with labelled rows - the name in the lead
//    sentence, the address in a "Full Address:" row, and an email under it.
const labelledAnswer = [
  'The public record information found for Franklin C. Peugh (also matching Frank Cecil Peugh) at the ZIP code 75115 is detailed below:',
  'Full Address: 130 Meadowbrook Dr, Desoto, TX 75115 (located in the Mantlebrook neighborhood).',
  'Email Address: fp@yahoo.com.',
  'Date of Birth (DOB): A specific day and month are not available in the public record snippet, but he is listed as over 65 years old.',
  'If you are looking for a specific birth year or need to confirm his phone numbers, let me know how you would proceed.'
].join('\n');

check('the labelled answer is read whole', api.extractAddressRecord(labelledAnswer, 'Frank Peugh'), {
  name: 'Franklin C. Peugh',
  address: {
    street: '130 Meadowbrook Dr',
    city: 'Desoto',
    state: 'TX',
    zip: '75115',
    full: '130 Meadowbrook Dr, Desoto, TX 75115'
  },
  email: 'fp@yahoo.com',
  dob: '',
  dobNote: '',
  note: ''
});

// 2. "…whats the full address?" answered with the address as its own lines, and with an aside about an
//    older address that must not be mistaken for the current one.
const lineAnswer = [
  "Jeffrey V. Green's full current address in the 44718 zip code is:",
  '2700 Orchard Park St NW',
  'Canton, OH 44718',
  'Records from the Ohio Resident Database and public directories show he has lived at this location for approximately 12 years. He also previously lived nearby at 2646 Orchard Park St NW within the same zip code.',
  "If you are looking for a specific Jeff Green and this doesn't look like the right person, let me know his approximate age or any co-residents/family members so I can narrow down the search."
].join('\n');

check('the line-per-line answer is joined into one address', api.extractAddressRecord(lineAnswer, 'Jeff Green'), {
  name: 'Jeffrey V. Green',
  address: {
    street: '2700 Orchard Park St NW',
    city: 'Canton',
    state: 'OH',
    zip: '44718',
    full: '2700 Orchard Park St NW, Canton, OH 44718'
  },
  email: '',
  dob: '',
  dobNote: '',
  note: ''
});

// 3. The name is only taken when it is the person that was asked about: an answer about somebody else
//    must not rename the card. The address it did state is still worth having.
check('a stranger\'s name is refused, the address kept', api.extractAddressRecord(lineAnswer, 'Maria Alvarez'), {
  name: '',
  address: {
    street: '2700 Orchard Park St NW',
    city: 'Canton',
    state: 'OH',
    zip: '44718',
    full: '2700 Orchard Park St NW, Canton, OH 44718'
  },
  email: '',
  dob: '',
  dobNote: '',
  note: ''
});

// 4. A street with no city or ZIP is still reported, and says so - the lookup after it completes it.
check('a street-only answer is reported with a note', api.extractAddressRecord(
  'The address found for Jane Doe is:\n4821 Maple Grove Ln',
  'Jane Doe'
), {
  name: 'Jane Doe',
  address: { street: '4821 Maple Grove Ln', city: '', state: '', zip: '', full: '4821 Maple Grove Ln' },
  email: '',
  dob: '',
  dobNote: '',
  note: 'no ZIP in the answer'
});

// 5. The real answer to "…what is the full address and born year?", which names the address and then the
//    year behind it: the year is read out of it, hedge and all, instead of being left in the paragraph.
const answerWithBirthYear = [
  'The full address for Jeffrey V. Green in Canton, OH is 2700 Orchard Park St NW, Canton, OH 44718.',
  'Public records from the Ohio Resident Database list his age as 67. Given the current year is 2026, his birth year is 1958 or early 1959.',
  'For further context regarding his professional background, details are available regarding his role at Green Land Surveying Co..'
].join('\n');

check('the birth year the answer names is read, hedge and all', api.extractAddressRecord(answerWithBirthYear, 'Jeff Green'), {
  name: 'Jeffrey V. Green',
  address: {
    street: '2700 Orchard Park St NW',
    city: 'Canton',
    state: 'OH',
    zip: '44718',
    full: '2700 Orchard Park St NW, Canton, OH 44718'
  },
  email: '',
  dob: '1958 or early 1959',
  dobNote: 'year only',
  note: ''
});

// 6. The other two ways a date arrives: a month and a year, and a date written as numbers. The note says
//    how much of a date was actually named, the same words the DOB run uses for its weaker rows.
check('a month and a year is read as such', api.extractAddressRecord(
  'Jane Doe was born in March 1958, according to the state voter file.',
  'Jane Doe'
), {
  name: '', address: null, email: '', dob: 'March 1958', dobNote: 'month/day unknown', note: ''
});

check('a stated date of birth is taken as it is written', api.extractAddressRecord(
  'Her date of birth is 09/16/1963.',
  'Jane Doe'
), {
  name: '', address: null, email: '', dob: '09/16/1963', dobNote: '', note: ''
});

// 7. Nothing usable in the answer at all: null, which is what makes the run ask its second query.
check('an answer with nothing in it reports nothing', api.extractAddressRecord(
  'I could not find a public record for this person. Could you share a phone number or an approximate age?',
  'Jane Doe'
), null);

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
