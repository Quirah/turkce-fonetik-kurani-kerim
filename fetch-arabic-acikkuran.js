/**
 * Fetch Arabic Quran from Açık Kuran API.
 *
 * The "verse" field contains the Türkiye Diyanet imlası (Türk imlası) text
 * with classical waqf marks (ۖ ۗ ۚ ۛ ۜ etc.) — same script that's printed in
 * the Mushaf used in Turkey and shown on acikkuran.com.
 */

const fs = require("fs");
const path = require("path");

const wbw = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "data/quranwbw-syllables.json"),
    "utf-8"
  )
);

async function fetchSurah(n) {
  const res = await fetch(`https://api.acikkuran.com/surah/${n}`);
  if (!res.ok) throw new Error(`surah ${n}: ${res.status}`);
  const j = await res.json();
  return j.data.verses;
}

(async () => {
  const out = {};
  let mismatches = 0;

  for (let s = 1; s <= 114; s++) {
    process.stdout.write(`\rFetching surah ${s}/114...`);
    const verses = await fetchSurah(s);
    for (const v of verses) {
      const key = `${s}:${v.verse_number}`;
      const txt = v.verse.trim().replace(/\s+/g, " ");
      const arWords = txt.split(" ");
      const wbwLen = (wbw[key] || []).length;
      if (arWords.length !== wbwLen) mismatches++;
      out[key] = txt;
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  console.log(`\nTotal verses: ${Object.keys(out).length}`);
  console.log(`Word count mismatches with WBW: ${mismatches}`);

  fs.writeFileSync(
    path.join(__dirname, "data/arabic-acikkuran-raw.json"),
    JSON.stringify(out, null, 2),
    "utf-8"
  );
  console.log("Wrote data/arabic-acikkuran-raw.json");
})();
