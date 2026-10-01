// Checks the email answers' reader against the two real Google AI Mode answers this was built from.
//
// Usage: node scratch/google_email_extract_test.js
//
// The reader is lifted straight out of google_email_automation.js (the constants and the two
// functions, nothing else), so what is tested is the shipping code rather than a copy of it.

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'google_email_automation.js'), 'utf8');

function grab(from, to) {
  const start = src.indexOf(from);
  if (start < 0) throw new Error(`anchor not found: ${from}`);
  const end = src.indexOf(to, start);
  if (end < 0) throw new Error(`end anchor not found: ${to}`);
  return src.slice(start, end);
}

const code = [
  grab('var EMAIL_RE', 'function isVisible'),
  grab('var NON_ANSWER_EMAIL_RE', '// The address the answer is actually about.'),
  grab('function extractEmail', '// ------------------------------------------------------------- removing the search-history entry')
].join('\n');

const api = new Function(code + '\nreturn { extractEmail: extractEmail, collectEmails: collectEmails };')();

let failures = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}\n        got  ${JSON.stringify(got)}`);
}

// 1. The Theresa Dunlap answer, exactly as the column renders it: prose, the primary address, a
//    Facebook row, then the household sentence with a relative's address.
const theresa = [
  'Based on publicly available records for Theresa Dunlap (born February 1950) associated with the',
  'address 765 E Fm 489, Buffalo, Texas 75831, the primary associated email address found in public',
  'profiles is: tjdunlap007@yahoo.com Facebook · Theresa Dunlap',
  'Additionally, records indicate this household has an active link to the following email address for',
  'family/co-occupants at that location: loften.dunlap@yahoo.com (associated with Loften Dunlap at the',
  'same address)'
].join(' ');

check('the primary address wins over the household one', api.extractEmail(theresa, 'Theresa Dunlap').primary, 'tjdunlap007@yahoo.com');
check('and it is not noted as a household address', api.extractEmail(theresa, 'Theresa Dunlap').note, '');

// 2. The Larry Fanning answer: the primary address sits between a note and a follow-up question.
const larry = [
  'The publicly available primary email address associated with Larry Fanning (born January 1949) at',
  '2337 Daisy Ln, Fort Worth, Texas 76111 is: lbf.masonry@yahoo.com ZoomInfo (+1)',
  '(Note: Public records indicate this email is tied to his local business operations, such as LBF',
  'Masonry.) If you need to contact him using other methods, I can provide his verified mobile phone',
  'number or the names of relatives associated with this household. Would you like that information?'
].join(' ');

check('the primary address is read with a note and a question after it', api.extractEmail(larry, 'Larry Fanning').primary, 'lbf.masonry@yahoo.com');

// 3. Nothing primary stated: the household address is still reported, and says what it is.
const householdOnly = [
  'Records for Theresa Dunlap in Buffalo, Texas list no primary email address. Additionally, records',
  'indicate this household has an active link to the following email address for family/co-occupants:',
  'loften.dunlap@yahoo.com'
].join(' ');

check('a household-only answer is reported as such', api.extractEmail(householdOnly, 'Theresa Dunlap'), {
  emails: ['loften.dunlap@yahoo.com'],
  primary: 'loften.dunlap@yahoo.com',
  note: 'household address'
});

// 4. An answer about somebody else is not this record's person - a relative at the same address who
//    shares the surname must never have their address put on this card.
const namesake = 'Based on publicly available records for Theresa Dunlap of Ohio, the primary email is someone.else@gmail.com';

check('a same-surname namesake does not pass as this person', api.extractEmail(namesake, 'Loften Dunlap'), null);

// 4b. The same answer read for the person it is actually about is accepted.
check('the person the answer names is accepted', api.extractEmail(namesake, 'Theresa Dunlap').primary, 'someone.else@gmail.com');

// 4c. A record that carries a middle initial is matched on first + last name, because the answer
//     writes the person without it.
check('a middle initial does not block the match', api.extractEmail(theresa, 'Theresa A Dunlap').primary, 'tjdunlap007@yahoo.com');

// 5. Mixed case and a duplicate are normalized to one lower-cased address.
check('addresses are lower-cased', api.collectEmails('TJDunlap007@Yahoo.com and tjdunlap007@yahoo.com'), ['tjdunlap007@yahoo.com']);

// 6. Google's own plumbing addresses are never reported.
check('a page address is dropped', api.collectEmails('write to noreply@example.com or see google.com'), []);

// 7. No address at all in the answer.
check('an answer with no address reports nothing', api.extractEmail('No public email address could be found for this person in Buffalo, Texas.', 'Theresa Dunlap'), null);

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
