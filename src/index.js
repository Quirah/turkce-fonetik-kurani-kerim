const { convertVerse, convertAll } = require("./convert");
const { needlemanWunsch } = require("./align");
const { normalizeWBWSyllable, normalizeAcikChar } = require("./normalize");

module.exports = {
  convertVerse,
  convertAll,
  needlemanWunsch,
  normalizeWBWSyllable,
  normalizeAcikChar,
};
