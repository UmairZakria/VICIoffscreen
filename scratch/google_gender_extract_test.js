// Checks the gender answers' reader against the real Google AI Mode answers this was built from.
//
// Usage: node scratch/google_gender_extract_test.js
//
// The reader is lifted straight out of google_gender_automation.js (the constants and the two
// functions, nothing else), so what is tested is the shipping code rather than a copy of it.

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'google_gender_automation.js'), 'utf8');

function grab(from, to) {
  const start = src.indexOf(from);
  if (start < 0) throw new Error(`anchor not found: ${from}`);
  const end = src.indexOf(to, start);
  if (end < 0) throw new Error(`end anchor not found: ${to}`);
  return src.slice(start, end);
}

const code = [
  grab('var MALE_GENDER_RE', '// ------------------------------------------------------------- removing the search-history entry')
].join('\n');

const api = new Function(code + '\nreturn { extractGender: extractGender };')();

let failures = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}\n        got  ${JSON.stringify(got)}`);
}

// 1. The Val Power answer, as the column renders it: the statement, then the follow-up list of who she
//    is - which is where the pronouns and the second gender word live.
const valPower = [
  'Val Power is female. Depending on the specific context or individual you are referring to, she is',
  'notable as: An Australian actor documented in theatre archives like AusStage. A prominent',
  'Ngarrindjeri woman known for her advocacy and cultural insights regarding Hindmarsh Island',
  '(Kumarangk) in South Australia.'
].join(' ');

check('the direct statement wins', api.extractGender(valPower, 'Val Power'), {
  gender: 'Female',
  note: '',
  score: 9
});

// 2. The John Enderli answer: the first sentence is about the *name*, the second is about the people
//    who carry it, and the question at the end names the person again with no gender word in it.
const johnEnderli = [
  'John is traditionally a male given name. Historical genealogical records, public profiles, and',
  'individuals sharing variations of the name (such as John Enderle or John Enderlin) are uniformly',
  'identified as male. Are you looking for information regarding a specific individual named John',
  'Enderli (such as a person in historical records, a public profile, or someone in a particular',
  'profession)? If you can share more context, I can help find details about them.'
].join(' ');

check('a name-style sentence does not outrank "identified as male"', api.extractGender(johnEnderli, 'John Enderli'), {
  gender: 'Male',
  note: '',
  score: 6
});

// 3. Only the name-style wording is available: still reported, but marked as indirect.
check('an indirect answer is marked as such', api.extractGender('Jane is traditionally a female given name.', 'Jane Doe'), {
  gender: 'Female',
  note: 'indirect wording',
  score: 2
});

// 4. The answer is about somebody else: nothing is reported, so the card is not given a stranger's
//    gender - and a gender word alone is never enough.
check('an answer about another person is refused', api.extractGender('John Smith is male.', 'Jane Doe'), null);

// 5. The answer itself says both: an answer that contradicts itself is not something to put on a card.
check('a name that is both is not reported', api.extractGender('Dana can be a male or a female name.', 'Dana White'), null);

// 6. Nothing about gender in the answer at all.
check('an answer with no gender word reports nothing', api.extractGender('Dana White lives in Buffalo, Texas.', 'Dana White'), null);

// 7. Only a pronoun supports it (the person is named in the first sentence, the pronoun carries the
//    second): reported, marked as indirect.
check('a pronoun is enough, marked as indirect', api.extractGender('Val Power works in theatre. She is based in Adelaide.', 'Val Power'), {
  gender: 'Female',
  note: 'indirect wording',
  score: 2
});

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
