// Throwaway probe: confirm the thatsthem.com URL shapes and that the record cards
// (name / "Born <Month> <Year> (N years old)" / address+zip) are in the raw HTML.
// Run: node scratch/thats_them_probe.js

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' };

const urls = [
  'https://thatsthem.com/name/Deborah-Williams/Houston-TX-77047',
  'https://thatsthem.com/address/3724-Kildare-Dr-Houston-TX-77047',
  'https://thatsthem.com/phone/713-252-6330',
];

function find(re, s) {
  const m = s.match(re);
  return m ? m[1] : null;
}

(async () => {
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: UA, redirect: 'follow' });
      const html = await res.text();
      const records = (html.match(/class="record[\s"]/g) || []).length;
      const born = find(/Born\s+([A-Za-z]+\s+\d{4}\s*\([^)]*\))/, html);
      const noResults = /No Results Found/i.test(html);
      const livesIn = find(/Lives in\s+([^<]{2,60})/, html);
      const knownAs = /Known as:/i.test(html);
      const currentAddr = find(/Current Address:[\s\S]{0,400}?<div>\s*([^<]{3,80})<\/div>/, html);
      console.log(`\n${url}\n  HTTP ${res.status}  final=${res.url}`);
      console.log(`  records=${records} noResults=${noResults} knownAs=${knownAs}`);
      console.log(`  born=${JSON.stringify(born)} livesIn=${JSON.stringify(livesIn)}`);
      console.log(`  currentAddress=${JSON.stringify(currentAddr)}`);
      console.log(`  cf/challenge=${/just a moment|cf-browser-verification|challenge-platform/i.test(html)}`);
    } catch (e) {
      console.log(`\n${url}\n  ERROR: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
})();
