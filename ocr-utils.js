export const OCR_ROTATIONS = [0, 90, 180, 270];

const LETTER_FIXES = new Map([
  ["0", "O"],
  ["1", "I"],
  ["5", "S"],
  ["8", "B"],
  ["@", "O"],
  ["$", "S"],
  ["|", "I"]
]);

export function normalizeOcrLetter(text) {
  const normalized = String(text || "")
    .toUpperCase()
    .replace(/[0158@$|]/g, (char) => LETTER_FIXES.get(char) || "")
    .replace(/[^A-Z]/g, "");

  if (!normalized) return "";
  if (normalized.startsWith("QU")) return "Q";
  return normalized[0];
}

export function chooseBestOcrCandidate(candidates) {
  return candidates.reduce((best, candidate) => {
    const letter = normalizeOcrLetter(candidate.text);
    const confidence = Number.isFinite(candidate.confidence) ? candidate.confidence : 0;
    const sourceBoost = candidate.source === "template" ? 8 : 0;
    const score = (letter ? 100 : -100) + confidence + sourceBoost - Math.abs(String(candidate.text || "").trim().length - 1) * 3;
    const normalized = { ...candidate, letter, score };

    if (!best || normalized.score > best.score) {
      return normalized;
    }

    return best;
  }, null) || { text: "", confidence: 0, rotation: 0, letter: "", score: -100 };
}

export function lettersToBoardInput(letters) {
  return letters.map((letter) => (letter === "QU" ? "Q" : normalizeOcrLetter(letter) || "E")).join("");
}

export function isWeakOcrCandidate(candidate) {
  return !candidate?.letter || candidate.confidence < 68;
}
