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

function applyTajweedMarks(wbwWord, turkishWord) {
  const wbwNFD = wbwWord.toLowerCase().replace(/[ʹʻ]/g, "").normalize("NFD");

  const DOT_BELOW = 0x323;
  const BREVE_BELOW = 0x324;

  // Collect info about specific letters
  function scanLetterMarks(nfd, targetChars) {
    const results = [];
    for (let i = 0; i < nfd.length; i++) {
      const ch = nfd[i];
      if (!targetChars.includes(ch)) continue;
      // Collect all combining marks after this char
      const marks = [];
      let j = i + 1;
      while (j < nfd.length && nfd.charCodeAt(j) >= 0x300 && nfd.charCodeAt(j) <= 0x36f) {
        marks.push(nfd.charCodeAt(j));
        j++;
      }
      results.push({ char: ch, marks });
    }
    return results;
  }

  // Apply a combining mark to matching letter positions in Turkish word
  function applyMark(trWord, wbwLetters, trTargetChars, hasMark, combiningChar) {
    // Find positions of target chars in Turkish
    const trPositions = [];
    for (let i = 0; i < trWord.length; i++) {
      if (trTargetChars.includes(trWord[i])) trPositions.push(i);
    }
    let result = trWord;
    let offset = 0;
    const minLen = Math.min(wbwLetters.length, trPositions.length);
    for (let i = 0; i < minLen; i++) {
      if (hasMark(wbwLetters[i])) {
        const pos = trPositions[i] + offset;
        result = result.slice(0, pos + 1) + combiningChar + result.slice(pos + 1);
        offset++;
      }
    }
    return result;
  }

  let trResult = turkishWord;
  let idgamApplied = false;

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

  // 1. ق (qaf) → g: WBW marks ق as 'q' (any, with or without dot below),
  //    Açık Kuran writes both ك and ق as 'k'. Map q-positions to k-positions in Turkish
  //    and replace with g.
  const wbwKQs = []; // base letter 'k' or 'q' in order (both normalize to 'k' in Turkish)
  for (let i = 0; i < wbwNFD.length; i++) {
    const ch = wbwNFD[i];
    if (ch === "k" || ch === "q") wbwKQs.push(ch);
  }
  const trKPositions = [];
  for (let i = 0; i < trResult.length; i++) {
    if (trResult[i] === "k") trKPositions.push(i);
  }
  {
    const chars = trResult.split("");
    const minLen = Math.min(wbwKQs.length, trKPositions.length);
    for (let i = 0; i < minLen; i++) {
      if (wbwKQs[i] === "q") chars[trKPositions[i]] = "g";
    }
    trResult = chars.join("");
  }

  // 2a. ذ (zel) = z+DOT_BELOW only → underline (peltek)
  const wbwZs = scanLetterMarks(wbwNFD, ["z"]);
  trResult = applyMark(trResult, wbwZs, ["z"],
    (l) => l.marks.includes(DOT_BELOW) && !l.marks.includes(BREVE_BELOW),
    COMBINING_LOW_LINE);

  // 2b. ظ (zı) = z+BREVE_BELOW+DOT_BELOW → peltek (underline) + kalın (dot above)
  trResult = applyMark(trResult, wbwZs, ["z"],
    (l) => l.marks.includes(BREVE_BELOW),
    COMBINING_LOW_LINE);
  trResult = applyMark(trResult, wbwZs, ["z"],
    (l) => l.marks.includes(BREVE_BELOW),
    COMBINING_DOT_ABOVE);

  // 3. Peltek s: ث = s+BREVE_BELOW
  const wbwSs = scanLetterMarks(wbwNFD, ["s"]);
  trResult = applyMark(trResult, wbwSs, ["s"],
    (l) => l.marks.includes(BREVE_BELOW), COMBINING_LOW_LINE);

  // 4. Kalın d (ض): d + DOT_BELOW in WBW
  const wbwDs = scanLetterMarks(wbwNFD, ["d"]);
  trResult = applyMark(trResult, wbwDs, ["d"],
    (l) => l.marks.includes(DOT_BELOW), COMBINING_DOT_ABOVE);

  // 5. Kalın t (ط): t + DOT_BELOW in WBW
  const wbwTs = scanLetterMarks(wbwNFD, ["t"]);
  trResult = applyMark(trResult, wbwTs, ["t"],
    (l) => l.marks.includes(DOT_BELOW), COMBINING_DOT_ABOVE);

  // 6. h classification in WBW:
  //    ه = plain h
  //    ح = h + DOT_BELOW → kalın h (ḥ)
  //    خ = k immediately followed by h (digraph "kh") → ḫ (breve below)
  //    Since all three become 'h' in Turkish, build a classified list in order.
  const wbwHTypes = []; // 'kh' | 'dot' | 'plain' per h-position in WBW
  for (let i = 0; i < wbwNFD.length; i++) {
    if (wbwNFD[i] !== "h") continue;
    // Check if part of "kh" digraph (preceded by plain 'k' with no combining marks between)
    const prev = i > 0 ? wbwNFD[i - 1] : "";
    if (prev === "k") {
      wbwHTypes.push("kh");
      continue;
    }
    // Check for dot below after
    let hasDot = false;
    let j = i + 1;
    while (j < wbwNFD.length && wbwNFD.charCodeAt(j) >= 0x300 && wbwNFD.charCodeAt(j) <= 0x36f) {
      if (wbwNFD.charCodeAt(j) === DOT_BELOW) hasDot = true;
      j++;
    }
    wbwHTypes.push(hasDot ? "dot" : "plain");
  }

  // Find h positions in Turkish and apply marks
  const trHPositions = [];
  for (let i = 0; i < trResult.length; i++) {
    if (trResult[i] === "h") trHPositions.push(i);
  }
  {
    let out = trResult;
    let offset = 0;
    const minLen = Math.min(wbwHTypes.length, trHPositions.length);
    for (let i = 0; i < minLen; i++) {
      const type = wbwHTypes[i];
      if (type === "plain") continue;
      const pos = trHPositions[i] + offset;
      const mark = type === "dot" ? COMBINING_MACRON : COMBINING_DOT_ABOVE;
      out = out.slice(0, pos + 1) + mark + out.slice(pos + 1);
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
  const starts = startTokens[verse] || [];
  const ends = endTokens[verse] || [];
  const processed = words.map((w, i) => {
    if (i >= wbwWords.length) return { word: w, idgamApplied: false };
    return applyTajweedMarks(wbwWords[i], w);
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
