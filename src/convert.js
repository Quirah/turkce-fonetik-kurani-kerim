/**
 * Core conversion logic.
 *
 * Takes QuranWBW word-by-word syllable transliteration and
 * Turkish phonetic text, produces Turkish transliteration
 * preserving the original word/syllable structure.
 */

const { normalizeWBWSyllable, normalizeAcikChar } = require("./normalize");
const { needlemanWunsch } = require("./align");

// ============================================================
// WBW Word Parsing
// ============================================================

/**
 * Parse a QuranWBW word into its components.
 *
 * @param {string} word - e.g. "Raḥ-maa-nir-"
 * @returns {{ syllables: string[], trailingDash: boolean, trailingPunct: string, isCapitalized: boolean }}
 */
function parseWBWWord(word) {
  let text = word;
  let trailingPunct = "";
  let trailingDash = false;

  // Extract trailing punctuation (only preserve . and ;)
  const punctMatch = text.match(/([.;!?,\u2015]+)$/);
  if (punctMatch) {
    trailingPunct = punctMatch[1].replace(/[!?,\u2015]/g, "");
    text = text.slice(0, -punctMatch[1].length);
  }

  // Check trailing dash (Arabic word connection marker)
  if (text.endsWith("-")) {
    trailingDash = true;
    text = text.slice(0, -1);
  }

  // Split into syllables
  const syllables = text.split("-").filter((s) => s.length > 0);

  // Detect capitalization (skip ʹ and ʻ markers)
  const firstLetter = word.replace(/^[ʹʻ]+/, "")[0] || "";
  const isCapitalized =
    firstLetter.length > 0 && firstLetter !== firstLetter.toLowerCase();

  return { syllables, trailingDash, trailingPunct, isCapitalized };
}

// ============================================================
// Normalized String Builders
// ============================================================

/**
 * Build normalized WBW string with word/syllable position tracking.
 */
function buildWBWNormalized(words) {
  let normStr = "";
  const wordRanges = [];
  const syllableRanges = [];
  const wordInfos = [];

  for (const word of words) {
    const info = parseWBWWord(word);
    wordInfos.push(info);

    const wordStart = normStr.length;
    const sylRanges = [];

    for (const syl of info.syllables) {
      const sylStart = normStr.length;
      normStr += normalizeWBWSyllable(syl);
      sylRanges.push({ start: sylStart, end: normStr.length });
    }

    wordRanges.push({ start: wordStart, end: normStr.length });
    syllableRanges.push(sylRanges);
  }

  return { normStr, wordRanges, syllableRanges, wordInfos };
}

/**
 * Build normalized Turkish string with position tracking back to original.
 */
function buildTurkishNormalized(text) {
  // Pre-clean: fix Turkish dotted i (i + combining dot above)
  const cleaned = text.replace(/i\u0307/g, "i");

  const noSpacesChars = [];
  const normChars = [];
  const normToNoSpacesMap = [];
  const noSpacesToToken = []; // token (space-separated) index per noSpaces char
  let tokenIdx = -1;
  let inToken = false;

  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (ch === " ") {
      inToken = false;
      continue;
    }
    if (!inToken) {
      tokenIdx++;
      inToken = true;
    }

    const noSpacesIdx = noSpacesChars.length;
    noSpacesChars.push(ch);
    noSpacesToToken.push(tokenIdx);

    const norm = normalizeAcikChar(ch);
    for (let j = 0; j < norm.length; j++) {
      normChars.push(norm[j]);
      normToNoSpacesMap.push(noSpacesIdx);
    }
  }

  return {
    normStr: normChars.join(""),
    noSpaces: noSpacesChars.join(""),
    normToNoSpacesMap,
    noSpacesToToken,
  };
}

// ============================================================
// Verse Conversion
// ============================================================

/**
 * Convert a single verse from WBW English to Turkish transliteration.
 *
 * @param {string[]} wbwWords - QuranWBW word array (e.g. ["Maa-li-ki", "Yaw-mid-", "Deen"])
 * @param {string} turkishText - Turkish phonetic text (e.g. "maliki yevmid din")
 * @returns {string[]} Turkish transliteration with syllable structure (e.g. ["Ma-li-ki", "Yev-mid-", "Din"])
 */
function convertVerse(wbwWords, turkishText) {
  const wbw = buildWBWNormalized(wbwWords);
  const turkish = buildTurkishNormalized(turkishText);

  const mapping = needlemanWunsch(wbw.normStr, turkish.normStr);

  const result = [];
  const startTokens = [];
  const endTokens = [];

  for (let w = 0; w < wbwWords.length; w++) {
    const wordRange = wbw.wordRanges[w];
    const sylRanges = wbw.syllableRanges[w];
    const info = wbw.wordInfos[w];

    // Find Turkish text range for this word via alignment
    let turkNormStart = -1,
      turkNormEnd = -1;
    for (let k = wordRange.start; k < wordRange.end; k++) {
      if (mapping[k] !== -1) {
        if (turkNormStart === -1) turkNormStart = mapping[k];
        turkNormEnd = mapping[k];
      }
    }

    if (turkNormStart === -1) {
      result.push(wbwWords[w]);
      startTokens.push(-1);
      endTokens.push(-1);
      continue;
    }

    // Map to original Turkish text positions (without spaces)
    const origStart = turkish.normToNoSpacesMap[turkNormStart];
    const origEnd = turkish.normToNoSpacesMap[turkNormEnd];
    const turkishWord = turkish.noSpaces.slice(origStart, origEnd + 1);
    const wordStartToken = turkish.noSpacesToToken[origStart];
    const wordEndToken = turkish.noSpacesToToken[origEnd];

    if (turkishWord.length === 0) {
      result.push(wbwWords[w]);
      startTokens.push(-1);
      endTokens.push(-1);
      continue;
    }

    // Apply syllable structure
    let syllableTexts;

    if (info.syllables.length <= 1) {
      syllableTexts = [turkishWord];
    } else {
      // Find split points using alignment-derived syllable boundaries
      const splitPoints = [];

      for (let s = 0; s < sylRanges.length - 1; s++) {
        const currentSyl = sylRanges[s];
        const nextSyl = sylRanges[s + 1];

        let lastMappedNorm = -1;
        for (let k = currentSyl.end - 1; k >= currentSyl.start; k--) {
          if (mapping[k] !== -1) {
            lastMappedNorm = mapping[k];
            break;
          }
        }

        let firstMappedNorm = -1;
        for (let k = nextSyl.start; k < nextSyl.end; k++) {
          if (mapping[k] !== -1) {
            firstMappedNorm = mapping[k];
            break;
          }
        }

        let splitInNoSpaces;
        if (lastMappedNorm !== -1 && firstMappedNorm !== -1) {
          const lastOrig = turkish.normToNoSpacesMap[lastMappedNorm];
          const firstOrig = turkish.normToNoSpacesMap[firstMappedNorm];
          splitInNoSpaces = Math.floor((lastOrig + firstOrig) / 2) + 1;
          if (splitInNoSpaces <= lastOrig) splitInNoSpaces = lastOrig + 1;
          if (splitInNoSpaces > firstOrig) splitInNoSpaces = firstOrig;
        } else if (lastMappedNorm !== -1) {
          splitInNoSpaces = turkish.normToNoSpacesMap[lastMappedNorm] + 1;
        } else if (firstMappedNorm !== -1) {
          splitInNoSpaces = turkish.normToNoSpacesMap[firstMappedNorm];
        } else {
          splitInNoSpaces =
            origStart +
            Math.round(
              ((s + 1) / info.syllables.length) * turkishWord.length
            );
        }

        splitInNoSpaces = Math.max(
          origStart,
          Math.min(origEnd + 1, splitInNoSpaces)
        );
        splitPoints.push(splitInNoSpaces);
      }

      // Ensure monotonically increasing
      for (let i = 1; i < splitPoints.length; i++) {
        if (splitPoints[i] <= splitPoints[i - 1]) {
          splitPoints[i] = splitPoints[i - 1] + 1;
        }
      }

      // Split Turkish word into syllables
      syllableTexts = [];
      let prevSplit = origStart;
      for (const sp of splitPoints) {
        const clampedSp = Math.min(sp, origEnd + 1);
        syllableTexts.push(turkish.noSpaces.slice(prevSplit, clampedSp));
        prevSplit = clampedSp;
      }
      syllableTexts.push(turkish.noSpaces.slice(prevSplit, origEnd + 1));

      // Remove empty syllables
      syllableTexts = syllableTexts.filter((t) => t.length > 0);
      if (syllableTexts.length === 0) {
        syllableTexts = [turkishWord];
      }
    }

    // Reconstruct word
    let newWord = syllableTexts.join("-");

    // Always lowercase
    newWord = newWord.toLowerCase();

    if (info.trailingDash) newWord += "-";
    newWord += info.trailingPunct;

    result.push(newWord);
    startTokens.push(wordStartToken);
    endTokens.push(wordEndToken);
  }

  return { words: result, startTokens, endTokens };
}

/**
 * Convert all verses from WBW English to Turkish transliteration.
 *
 * @param {Record<string, string[]>} wbwData - Full QuranWBW dataset { "1:1": ["Bis-mil-", ...], ... }
 * @param {Record<string, string>} turkishData - Full Turkish phonetic dataset { "1:1": "bismillahir ...", ... }
 * @returns {{ result: Record<string, string[]>, stats: { processed: number, errors: number, errorVerses: string[] } }}
 */
function convertAll(wbwData, turkishData) {
  const result = {};
  const startTokens = {};
  const endTokens = {};
  let processed = 0;
  let errors = 0;
  const errorVerses = [];

  for (const [verse, words] of Object.entries(wbwData)) {
    if (!turkishData[verse]) {
      result[verse] = words;
      startTokens[verse] = words.map((_, i) => i);
      endTokens[verse] = words.map((_, i) => i);
      errors++;
      errorVerses.push(verse);
      continue;
    }

    try {
      const r = convertVerse(words, turkishData[verse]);
      result[verse] = r.words;
      startTokens[verse] = r.startTokens;
      endTokens[verse] = r.endTokens;
      processed++;
    } catch (e) {
      result[verse] = words;
      startTokens[verse] = words.map((_, i) => i);
      endTokens[verse] = words.map((_, i) => i);
      errors++;
      errorVerses.push(verse);
    }
  }

  return { result, startTokens, endTokens, stats: { processed, errors, errorVerses } };
}

module.exports = { convertVerse, convertAll, parseWBWWord };
