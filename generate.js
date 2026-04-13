/**
 * Generate Turkish syllable transliteration from source data.
 *
 * Usage: node generate.js
 *
 * Reads:
 *   data/quranwbw-syllables.json      (QuranWBW word-by-word English transliteration)
 *   data/acikkuran-turkish-phonetic.json (Açık Kuran Turkish phonetic transliteration)
 *
 * Writes:
 *   output/turkish-syllables.json     (Turkish word-by-word syllable transliteration)
 */

const fs = require("fs");
const path = require("path");
const { convertAll } = require("./src/convert");

const wbwData = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "data/quranwbw-syllables.json"),
    "utf-8"
  )
);

const turkishData = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "data/acikkuran-turkish-phonetic.json"),
    "utf-8"
  )
);

const arabicData = JSON.parse(
  fs.readFileSync(path.join(__dirname, "data/arabic-uthmani.json"), "utf-8")
);

// Classify Arabic consonants for tajweed marking.
// Returns an array of {cls, type} in orthographic order, one per Arabic consonant.
//   cls  — which Turkish letter class this maps to (z/d/t/s/h/k)
//   type — subclass: 'plain' | 'peltek' | 'kalin' | 'peltekKalin' | 'kh' | 'q'
const ARABIC_CLASS = {
  "\u0630": { cls: "z", type: "peltek" }, // ذ zel
  "\u0632": { cls: "z", type: "plain" }, // ز ze
  "\u0638": { cls: "z", type: "peltekKalin" }, // ظ zı
  "\u062F": { cls: "d", type: "plain" }, // د dal
  "\u0636": { cls: "d", type: "kalin" }, // ض dad
  "\u062A": { cls: "t", type: "plain" }, // ت te
  "\u0637": { cls: "t", type: "kalin" }, // ط tı
  "\u062B": { cls: "s", type: "peltek" }, // ث se
  "\u0633": { cls: "s", type: "plain" }, // س sin
  "\u0635": { cls: "s", type: "plain" }, // ص sad
  "\u062D": { cls: "h", type: "kalin" }, // ح ha
  "\u062E": { cls: "h", type: "kh" }, // خ hı
  "\u0647": { cls: "h", type: "plain" }, // ه he
  "\u0643": { cls: "k", type: "plain" }, // ك kef
  "\u0642": { cls: "k", type: "q" }, // ق kaf
};
function classifyArabic(arWord) {
  const out = [];
  for (const ch of arWord) {
    const info = ARABIC_CLASS[ch];
    if (info) out.push(info);
  }
  return out;
}

console.log("Converting...");
const { result, startTokens, endTokens, stats } = convertAll(wbwData, turkishData);

// === Generate tajweed version ===
// Transfer tajweed marks from WBW to Turkish output:
//   n → m/v/y/l/r     — idgam (tanwin/nun assimilates into next consonant)
//   q → g             — ق (kaf-ı kalın) okunuşu g
//   z̲ / s̲  (U+0332)   — peltek z / peltek s (ذ, ث)
//   ḋ  (U+0307)       — kalın d (ض)
//   ṫ  (U+0307)       — kalın t (ط)
//   ż̲ (U+0332+U+0307) — kalın+peltek z (ظ)
//   h̄ (U+0304)        — kalın h (ح)
//   ḣ (U+0307)        — kh / hı (خ)
const COMBINING_LOW_LINE = "\u0332"; // underline for peltek (ذ, ث, ظ)
const COMBINING_DOT_ABOVE = "\u0307"; // dot above for kalın letters (ض, ط, ظ, خ)
const COMBINING_MACRON = "\u0304"; // overline for kalın h (ح)

// Strip diacritics + turn wbw char into its Turkish equivalent consonant
function wbwLastConsonant(wbwWord) {
  const nfd = wbwWord.toLowerCase().replace(/[ʹʻ\-.,;!?˹˺()]/g, "").normalize("NFD");
  // strip combining marks
  const stripped = nfd.replace(/[\u0300-\u036f]/g, "");
  // map w→v (Turkish uses v)
  const mapped = stripped.replace(/w/g, "v").replace(/q/g, "k");
  const m = mapped.match(/([bcdfghjklmnpqrstvxyz])[^a-z]*$/);
  return m ? m[1] : null;
}

function trLastConsonantInfo(trWord) {
  // Find index of last consonant ignoring trailing punctuation/dashes
  for (let i = trWord.length - 1; i >= 0; i--) {
    const ch = trWord[i];
    if (/[bcdfghjklmnpqrstvxyz]/.test(ch)) return { index: i, char: ch };
  }
  return null;
}

function applyTajweedMarks(wbwWord, turkishWord, arabicWord) {
  let trResult = turkishWord;
  let idgamApplied = false;

  // Apply marks/replacements to Turkish letters matching a class, by ordinal index.
  // arClasses: array of {cls,type} for this letter class (in Arabic order).
  // applyFn: (arInfo, trChars, index) => void  — mutates trChars
  function processClass(trWord, cls, arClasses, applyFn) {
    const chars = [...trWord];
    const trPositions = [];
    for (let i = 0; i < chars.length; i++) {
      if (chars[i] === cls) trPositions.push(i);
    }
    const n = Math.min(arClasses.length, trPositions.length);
    for (let i = 0; i < n; i++) {
      applyFn(arClasses[i], chars, trPositions[i]);
    }
    return chars.join("");
  }

  // 0. IDGAM: replace last consonant of Turkish word with WBW's last consonant
  //    when they differ. Only when Turkish ends in n/m and WBW ends in m/v/y/l/r.
  const trLast = trLastConsonantInfo(trResult);
  const wbwLast = wbwLastConsonant(wbwWord);
  if (trLast && wbwLast && trLast.char !== wbwLast) {
    if (/[nm]/.test(trLast.char) && /[mvylr]/.test(wbwLast)) {
      trResult = trResult.slice(0, trLast.index) + wbwLast + trResult.slice(trLast.index + 1);
      idgamApplied = true;
    }
  }

  // Authoritative tajweed marking from Arabic source.
  // For each Turkish letter class, collect Arabic letters of that class in order,
  // then align by ordinal index with Turkish positions.
  const arClass = classifyArabic(arabicWord || "");
  const byClass = { z: [], d: [], t: [], s: [], h: [], k: [] };
  for (const info of arClass) byClass[info.cls].push(info);

  // 1. ق (qaf) → g: replace k with g at matching positions
  trResult = processClass(trResult, "k", byClass.k, (info, chars, pos) => {
    if (info.type === "q") chars[pos] = "g";
  });

  // 2. z-class: ذ → z̲, ظ → ż̲, ز → z (plain)
  //    Insert combining marks after the z.
  {
    const chars = [...trResult];
    const trPositions = [];
    for (let i = 0; i < chars.length; i++) if (chars[i] === "z") trPositions.push(i);
    const n = Math.min(byClass.z.length, trPositions.length);
    let out = trResult;
    let offset = 0;
    for (let i = 0; i < n; i++) {
      const info = byClass.z[i];
      const insertAt = trPositions[i] + offset + 1;
      let marks = "";
      if (info.type === "peltek") marks = COMBINING_LOW_LINE;
      else if (info.type === "peltekKalin") marks = COMBINING_LOW_LINE + COMBINING_DOT_ABOVE;
      if (marks) {
        out = out.slice(0, insertAt) + marks + out.slice(insertAt);
        offset += marks.length;
      }
    }
    trResult = out;
  }

  // 3. s-class: ث → s̲ (peltek); ص, س → plain
  {
    const trPositions = [];
    for (let i = 0; i < trResult.length; i++) if (trResult[i] === "s") trPositions.push(i);
    const n = Math.min(byClass.s.length, trPositions.length);
    let out = trResult;
    let offset = 0;
    for (let i = 0; i < n; i++) {
      if (byClass.s[i].type === "peltek") {
        const insertAt = trPositions[i] + offset + 1;
        out = out.slice(0, insertAt) + COMBINING_LOW_LINE + out.slice(insertAt);
        offset++;
      }
    }
    trResult = out;
  }

  // 4. d-class: ض → ḋ (kalın dot above); د → plain
  {
    const trPositions = [];
    for (let i = 0; i < trResult.length; i++) if (trResult[i] === "d") trPositions.push(i);
    const n = Math.min(byClass.d.length, trPositions.length);
    let out = trResult;
    let offset = 0;
    for (let i = 0; i < n; i++) {
      if (byClass.d[i].type === "kalin") {
        const insertAt = trPositions[i] + offset + 1;
        out = out.slice(0, insertAt) + COMBINING_DOT_ABOVE + out.slice(insertAt);
        offset++;
      }
    }
    trResult = out;
  }

  // 5. t-class: ط → ṫ (kalın dot above); ت → plain
  {
    const trPositions = [];
    for (let i = 0; i < trResult.length; i++) if (trResult[i] === "t") trPositions.push(i);
    const n = Math.min(byClass.t.length, trPositions.length);
    let out = trResult;
    let offset = 0;
    for (let i = 0; i < n; i++) {
      if (byClass.t[i].type === "kalin") {
        const insertAt = trPositions[i] + offset + 1;
        out = out.slice(0, insertAt) + COMBINING_DOT_ABOVE + out.slice(insertAt);
        offset++;
      }
    }
    trResult = out;
  }

  // 6. h-class: ح → h̄ (macron); خ → ḣ (dot above); ه → plain
  {
    const trPositions = [];
    for (let i = 0; i < trResult.length; i++) if (trResult[i] === "h") trPositions.push(i);
    const n = Math.min(byClass.h.length, trPositions.length);
    let out = trResult;
    let offset = 0;
    for (let i = 0; i < n; i++) {
      const info = byClass.h[i];
      if (info.type === "plain") continue;
      const mark = info.type === "kalin" ? COMBINING_MACRON : COMBINING_DOT_ABOVE;
      const insertAt = trPositions[i] + offset + 1;
      out = out.slice(0, insertAt) + mark + out.slice(insertAt);
      offset++;
    }
    trResult = out;
  }

  return { word: trResult, idgamApplied };
}

// Strip trailing dash from a word (handles trailing punctuation too)
function stripTrailingDash(w) {
  // Match trailing dash optionally followed by punctuation
  return w.replace(/-([.,;!?]*)$/, "$1");
}

// Apply trailing dash when:
//   (a) word i's end-token equals word i+1's start-token (Açık Kuran token boundary), OR
//   (b) the WBW word has an authoritative trailing dash (idgam / definite-article merge).
// Trailing dash on output = "merge with next bubble".
function applyTokenGrouping(words, starts, ends, wbwWords) {
  return words.map((w, i) => {
    const stripped = stripTrailingDash(w);
    if (i + 1 >= words.length) return stripped;
    const tokenConnect =
      ends[i] !== -1 &&
      starts[i + 1] !== -1 &&
      ends[i] === starts[i + 1];
    const wbwTrailing = wbwWords && wbwWords[i] && /-[.,;:!?˹˺]*$/.test(wbwWords[i]);
    if (!tokenConnect && !wbwTrailing) return stripped;
    const m = stripped.match(/^(.*?)([.,;!?]*)$/);
    return m[1] + "-" + m[2];
  });
}

// === Basic level: group by Açık Kuran token boundaries + WBW trailing dashes ===
const basicResult = {};
for (const [verse, words] of Object.entries(result)) {
  basicResult[verse] = applyTokenGrouping(
    words,
    startTokens[verse] || [],
    endTokens[verse] || [],
    wbwData[verse] || []
  );
}

fs.writeFileSync(
  path.join(__dirname, "output/turkish-syllables.json"),
  JSON.stringify(basicResult, null, 2),
  "utf-8"
);

// Helpers for shamsi idgam detection across token boundaries
function firstConsonant(w) {
  const stripped = w.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f\-'.,;:!?]/g, "");
  const m = stripped.match(/^[^a-zşğç]*([bcdfghjklmnpqrstvxyzşğç])/);
  return m ? m[1] : null;
}
function lastConsonant(w) {
  const stripped = w.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f\-'.,;:!?]/g, "");
  const m = stripped.match(/([bcdfghjklmnpqrstvxyzşğç])[^a-zşğç]*$/);
  return m ? m[1] : null;
}

// === Tajweed level: token grouping + idgam merging + letter-level marks ===
const tajweedResult = {};
for (const [verse, words] of Object.entries(result)) {
  const wbwWords = wbwData[verse] || [];
  const arWords = (arabicData[verse] || "").split(" ");
  const starts = startTokens[verse] || [];
  const ends = endTokens[verse] || [];
  const processed = words.map((w, i) => {
    if (i >= wbwWords.length) return { word: w, idgamApplied: false };
    return applyTajweedMarks(wbwWords[i], w, arWords[i]);
  });
  tajweedResult[verse] = processed.map((p, i) => {
    const stripped = stripTrailingDash(p.word);
    let merge = false;
    // (a) Açık Kuran token boundary match
    if (i + 1 < processed.length && ends[i] !== -1 && starts[i + 1] !== -1 && ends[i] === starts[i + 1]) {
      merge = true;
    }
    // (b) Idgam n→m/v/y/l/r applied inside applyTajweedMarks
    if (!merge && p.idgamApplied) merge = true;
    // (c) WBW authoritative trailing dash (covers shamsi idgam, definite-article merge, etc.)
    if (!merge && i + 1 < processed.length) {
      const wbwWord = wbwWords[i];
      if (wbwWord && /-[.,;:!?˹˺]*$/.test(wbwWord)) merge = true;
    }
    if (!merge) return stripped;
    const m = stripped.match(/^(.*?)([.,;!?]*)$/);
    return m[1] + "-" + m[2];
  });
}

fs.writeFileSync(
  path.join(__dirname, "output/turkish-syllables-tajweed.json"),
  JSON.stringify(tajweedResult, null, 2),
  "utf-8"
);

console.log(`Done. ${stats.processed} ayet islendi, ${stats.errors} hata.`);

if (stats.errorVerses.length > 0) {
  console.log(`Hata ayetleri: ${stats.errorVerses.join(", ")}`);
}

// Sample output
const samples = ["1:1", "1:4", "2:255", "36:1", "112:1"];
console.log("\nOrnekler:");
for (const v of samples) {
  if (result[v]) {
    console.log(`  ${v}: ${result[v].join(" ")}`);
  }
}
