/**
 * Build data/arabic-uthmani.json from mahfuz tajweed source.
 *
 * Source: C:/Users/Samet1/newmah/mahfuz/apps/web/public/tajweed/{n}.json
 * Standard Uthmani Hafs script with waqf marks (the most common Quran text in Turkey).
 *
 * Steps:
 *   - strip <tajweed class=...> annotation tags
 *   - strip ZWNJ (U+200C), tatweel (U+0640), hizb marker (U+06DE), sajdah (U+06E9)
 *   - split by spaces
 *   - for verses where word count differs from WBW, merge specific known cases with NBSP
 */

const fs = require("fs");
const path = require("path");

const NBSP = "\u00A0";
const TAJWEED_DIR = "C:/Users/Samet1/newmah/mahfuz/apps/web/public/tajweed";

const wbw = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "data/quranwbw-syllables.json"),
    "utf-8"
  )
);

// Manual fix list: { verse: [indicesToJoinWithNext] }
// Cases where the Arabic source splits a word that WBW (and recitation) treats as one.
const MANUAL_JOINS = {
  "8:6": [3], // بَعْدَ + مَا → بَعْدَ‍مَا
  "37:130": [1], // إِلْ + يَاسِينَ → إِلْ‍يَاسِينَ
};

function cleanVerse(raw) {
  return raw
    .replace(/<\/?tajweed[^>]*>/g, "")
    .replace(/[\u0640\u200C\u06DE\u06E9]/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

const out = {};
let mismatches = 0;

for (let s = 1; s <= 114; s++) {
  const j = JSON.parse(
    fs.readFileSync(path.join(TAJWEED_DIR, `${s}.json`), "utf-8")
  );
  for (const verse of Object.keys(j)) {
    const cleaned = cleanVerse(j[verse]);
    let words = cleaned.split(" ");

    if (MANUAL_JOINS[verse]) {
      const indices = new Set(MANUAL_JOINS[verse]);
      const merged = [];
      for (let i = 0; i < words.length; i++) {
        if (indices.has(i) && i + 1 < words.length) {
          merged.push(words[i] + NBSP + words[i + 1]);
          i++;
        } else {
          merged.push(words[i]);
        }
      }
      words = merged;
    }

    const wbwLen = (wbw[verse] || []).length;
    if (words.length !== wbwLen) {
      mismatches++;
      console.log(`MISMATCH ${verse}: wbw=${wbwLen} ar=${words.length}`);
      console.log("  ", JSON.stringify(words));
    }
    out[verse] = words.join(" ");
  }
}

fs.writeFileSync(
  path.join(__dirname, "data/arabic-uthmani.json"),
  JSON.stringify(out, null, 2),
  "utf-8"
);

console.log(`Done. ${Object.keys(out).length} verses, ${mismatches} mismatches.`);
