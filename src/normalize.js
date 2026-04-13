/**
 * Normalization utilities for transliteration alignment.
 *
 * Normalizes both QuranWBW (English) and Turkish phonetic text
 * to a common phonetic representation for alignment.
 */

/**
 * Normalize a single QuranWBW syllable for alignment.
 * Handles digraphs (sh, kh, th), long vowels, and special Unicode characters.
 *
 * @param {string} syl - A single syllable from QuranWBW (e.g. "Raḥ", "maa", "nir")
 * @returns {string} Normalized form (e.g. "rah", "ma", "nir")
 */
function normalizeWBWSyllable(syl) {
  let s = syl.toLowerCase();

  // Remove hamza/ayn markers
  s = s.replace(/[ʹʻ]/g, "");

  // Protect digraphs before NFD decomposition
  s = s.replace(/gh/g, "\x04");
  s = s.replace(/sh/g, "\x01");
  s = s.replace(/kh/g, "\x02");
  s = s.replace(/th/g, "\x03");

  // NFD decompose + strip combining marks (ḥ→h, ṣ→s, ẓ→z, ṭ→t, ḍ→d, etc.)
  s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  // Restore digraph placeholders as Turkish equivalents
  s = s.replace(/\x04/g, "g"); // gh (غ) → g (matches Turkish ğ→g)
  s = s.replace(/\x01/g, "s"); // sh (ش) → s (matches Turkish ş→s)
  s = s.replace(/\x02/g, "h"); // kh (خ) → h
  s = s.replace(/\x03/g, "s"); // th (ث) → s

  // Collapse long vowels (pair-wise for better alignment)
  s = s.replace(/aa/g, "a");
  s = s.replace(/ee/g, "i");
  s = s.replace(/oo/g, "u");

  // Character mappings to Turkish equivalents
  s = s.replace(/q/g, "k");
  s = s.replace(/w/g, "v");

  // Remove any remaining non-letter characters
  s = s.replace(/[^a-z]/g, "");

  return s;
}

/**
 * Normalize a single character from Turkish phonetic text for alignment.
 *
 * @param {string} ch - A single character
 * @returns {string} Normalized form, or '' if the character should be skipped
 */
function normalizeAcikChar(ch) {
  if (ch === " " || ch === "'") return "";

  let s = ch.toLowerCase();

  // Turkish dotless ı → i
  if (s === "\u0131") return "i";

  // NFD decompose + strip combining marks (ş→s, ç→c, etc.)
  s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  if (s.length === 0 || !/[a-z]/.test(s)) return "";

  return s;
}

module.exports = { normalizeWBWSyllable, normalizeAcikChar };
