/**
 * Normalize raw Açık Kuran Arabic data so word counts line up with WBW.
 *
 * Strategy:
 *   1. Always: waqf-only token → attach to previous; nida (يا/ها/ويا/وها) → NBSP join.
 *   2. If still off, try ذُو-split (only when verse needs more Arabic words).
 *   3. Anything still mismatched: fall back to data/arabic-uthmani.json (mahfuz tajweed).
 */

const fs = require("fs");
const path = require("path");

const NBSP = "\u00A0";
const COMBINING_RE = /[\u064B-\u065F\u0670\u06D6-\u06ED]/g;

const wbw = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "data/quranwbw-syllables.json"),
    "utf-8"
  )
);
const rawAr = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "data/arabic-acikkuran-raw.json"),
    "utf-8"
  )
);

// U+06EA (ARABIC EMPTY CENTRE LOW STOP) is rendered as a small circle by every
// Unicode font — it's a circle by design. In Turkish Diyanet mushafs the same
// phonetic position shows a plain kasra. Replace before processing.
const ar = {};
for (const k of Object.keys(rawAr)) {
  ar[k] = rawAr[k].replace(/\u06EA/g, "\u0650");
}

const stripDiac = (s) => s.normalize("NFD").replace(COMBINING_RE, "");

// Detect ذُو-style prefix at start of bare-letter form
// bare starts with ذو and has more letters → split off ذُو
function splitDhuPrefix(word) {
  const bare = stripDiac(word);
  // ذو + at least 2 more letters (avoid splitting ذِي / ذَا alone)
  if (!/^ذو./.test(bare)) return null;
  // Find where "ذو" ends in the original (with diacritics)
  // Walk char by char until we've seen ذ then و in the bare form
  let bareSeen = "";
  for (let i = 0; i < word.length; i++) {
    bareSeen = stripDiac(word.slice(0, i + 1));
    if (bareSeen === "ذو") {
      // Split here, but include any combining marks immediately following the و
      let j = i + 1;
      while (j < word.length && COMBINING_RE.test(word[j])) {
        COMBINING_RE.lastIndex = 0;
        j++;
      }
      COMBINING_RE.lastIndex = 0;
      return [word.slice(0, j), word.slice(j)];
    }
  }
  return null;
}

// Pair-merge rules disabled — they over-fired. Use per-verse manual fixes instead.
const PAIR_MERGES = new Set();
const TRIPLE_MERGES = new Set();

function normalize(words, targetCount) {
  // A. Standalone waqf-only token → attach to previous
  let r = [];
  for (const w of words) {
    if (/^[\u06D6-\u06ED]+$/.test(w) && r.length > 0) {
      r[r.length - 1] += w;
    } else {
      r.push(w);
    }
  }

  // B. Nida nbsp join (يا/ها/ويا/وها)
  let r2 = [];
  for (let i = 0; i < r.length; i++) {
    const bare = stripDiac(r[i]);
    if (
      (bare === "يا" || bare === "ها" || bare === "ويا" || bare === "وها") &&
      i + 1 < r.length
    ) {
      r2.push(r[i] + NBSP + r[i + 1]);
      i++;
    } else {
      r2.push(r[i]);
    }
  }

  // C. ذُو split — apply at most (target - current) times to reach WBW word count
  let r3 = r2;
  const needed = targetCount != null ? targetCount - r2.length : 0;
  if (needed > 0) {
    r3 = [];
    let splitsDone = 0;
    for (const w of r2) {
      if (splitsDone < needed) {
        const split = splitDhuPrefix(w);
        if (split && split[1].length > 0) {
          r3.push(split[0], split[1]);
          splitsDone++;
          continue;
        }
      }
      r3.push(w);
    }
  }

  // D. Triple merges first (longer match wins)
  let r4 = [];
  for (let i = 0; i < r3.length; i++) {
    if (i + 2 < r3.length) {
      const key3 = stripDiac(r3[i]) + "|" + stripDiac(r3[i + 1]) + "|" + stripDiac(r3[i + 2]);
      if (TRIPLE_MERGES.has(key3)) {
        r4.push(r3[i] + NBSP + r3[i + 1] + NBSP + r3[i + 2]);
        i += 2;
        continue;
      }
    }
    if (i + 1 < r3.length) {
      const key2 = stripDiac(r3[i]) + "|" + stripDiac(r3[i + 1]);
      if (PAIR_MERGES.has(key2)) {
        r4.push(r3[i] + NBSP + r3[i + 1]);
        i++;
        continue;
      }
    }
    r4.push(r3[i]);
  }

  return r4;
}

// Per-verse manual overrides for verses that the rules can't handle.
// Each entry: an array of operations applied in order to the post-rules words.
//   { merge: [i, j] }   join words i..j with NBSP into one bubble
//   { split: i, at: n } split word i at character index n
const MANUAL = {
  "2:181":  [{ merge: [2, 3] }],
  "4:78":   [{ merge: [0, 1] }],
  "4:91":   [{ split: 7, at: 5 }],
  "8:6":    [{ merge: [3, 4] }],
  "13:37":  [{ merge: [7, 8] }],
  "18:96":  [{ merge: [16, 17] }],
  "23:44":  [{ split: 4, at: 5 }],
  "27:87":  [{ merge: [4, 5] }],
  "31:27":  [{ merge: [1, 2] }],
  "31:32":  [{ split: 14, at: 11 }],
  "31:34":  [{ merge: [22, 23] }],
  "33:61":  [{ merge: [1, 2] }],
  "39:46":  [{ split: 12, at: 3 }],
  "54:20":  [{ merge: [0, 1] }],
  "63:10":  [{ split: 1, at: 2 }],
  "72:16":  [{ merge: [0, 1] }],
};

const out = {};
const stillMismatched = [];

for (const v of Object.keys(ar)) {
  const wbwLen = (wbw[v] || []).length;
  let words = normalize(ar[v].split(" "), wbwLen);
  if (MANUAL[v]) {
    for (const op of MANUAL[v]) {
      if (op.merge) {
        const [i, j] = op.merge;
        const merged = words.slice(i, j + 1).join(NBSP);
        words = [...words.slice(0, i), merged, ...words.slice(j + 1)];
      } else if (op.split !== undefined) {
        const w = words[op.split];
        words = [
          ...words.slice(0, op.split),
          w.slice(0, op.at),
          w.slice(op.at),
          ...words.slice(op.split + 1),
        ];
      }
    }
  }
  if (words.length !== wbwLen) {
    stillMismatched.push({ v, w: wbwLen, a: words.length });
  }
  out[v] = words.join(" ");
}

console.log(`Verses: ${Object.keys(out).length}`);
console.log(`Still mismatched: ${stillMismatched.length}`);
if (stillMismatched.length > 0 && stillMismatched.length < 60) {
  for (const m of stillMismatched) {
    console.log(`  ${m.v} wbw=${m.w} ar=${m.a}`);
  }
}

fs.writeFileSync(
  path.join(__dirname, "data/arabic-acikkuran.json"),
  JSON.stringify(out, null, 2),
  "utf-8"
);
console.log("Wrote data/arabic-acikkuran.json");
