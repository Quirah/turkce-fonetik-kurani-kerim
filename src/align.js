/**
 * Needleman-Wunsch sequence alignment algorithm.
 *
 * Aligns two normalized phonetic strings character-by-character,
 * producing a position mapping from seq1 → seq2.
 */

const MATCH = 2;
const SIMILAR = 0;
const MISMATCH = -1;
const GAP = -2;

// Character pairs that are considered phonetically similar
// across English↔Turkish transliteration
const SIMILAR_PAIRS = new Set([
  "ae", "ea", // a↔e (common in Arabic→Turkish)
  "iu", "ui", // i↔u
  "io", "oi", // i↔o
]);

function score(a, b) {
  if (a === b) return MATCH;
  if (SIMILAR_PAIRS.has(a + b)) return SIMILAR;
  return MISMATCH;
}

/**
 * Needleman-Wunsch global alignment.
 *
 * @param {string} seq1 - First normalized sequence (WBW)
 * @param {string} seq2 - Second normalized sequence (Turkish)
 * @returns {Int16Array} mapping where mapping[i] = position in seq2 that seq1[i] aligns to, or -1 for gaps
 */
function needlemanWunsch(seq1, seq2) {
  const m = seq1.length;
  const n = seq2.length;

  if (m === 0 || n === 0) return new Int16Array(m).fill(-1);

  // DP table
  const dp = new Array(m + 1);
  const trace = new Array(m + 1);
  for (let i = 0; i <= m; i++) {
    dp[i] = new Float32Array(n + 1);
    trace[i] = new Uint8Array(n + 1);
  }

  for (let i = 1; i <= m; i++) {
    dp[i][0] = i * GAP;
    trace[i][0] = 1;
  }
  for (let j = 1; j <= n; j++) {
    dp[0][j] = j * GAP;
    trace[0][j] = 2;
  }

  // Fill
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const diag = dp[i - 1][j - 1] + score(seq1[i - 1], seq2[j - 1]);
      const up = dp[i - 1][j] + GAP;
      const left = dp[i][j - 1] + GAP;

      if (diag >= up && diag >= left) {
        dp[i][j] = diag;
        trace[i][j] = 0; // diagonal
      } else if (up >= left) {
        dp[i][j] = up;
        trace[i][j] = 1; // up (gap in seq2)
      } else {
        dp[i][j] = left;
        trace[i][j] = 2; // left (gap in seq1)
      }
    }
  }

  // Traceback
  const mapping = new Int16Array(m).fill(-1);
  let i = m,
    j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && trace[i][j] === 0) {
      mapping[i - 1] = j - 1;
      i--;
      j--;
    } else if (i > 0 && (j === 0 || trace[i][j] === 1)) {
      i--;
    } else {
      j--;
    }
  }

  return mapping;
}

module.exports = { needlemanWunsch };
