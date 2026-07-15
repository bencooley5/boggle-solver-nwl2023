import { resolveDefinition } from "./solver-core.js";

export function normalizeRack(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z]/g, "");
}

export function canBuildWord(word, rack) {
  const normalizedWord = normalizeRack(word);
  const normalizedRack = normalizeRack(rack);
  if (!normalizedWord || normalizedWord.length > normalizedRack.length) return false;

  const available = countLetters(normalizedRack);
  for (const letter of normalizedWord) {
    const index = letter.charCodeAt(0) - 65;
    available[index] -= 1;
    if (available[index] < 0) return false;
  }
  return true;
}

export function findRackWords(rack, dictionary, options = {}) {
  const normalizedRack = normalizeRack(rack);
  const rackCounts = countLetters(normalizedRack);
  const minLength = Math.max(2, options.minLength ?? 3);
  const maxLength = Math.min(normalizedRack.length, options.maxLength ?? normalizedRack.length);
  const results = [];

  for (const [word] of dictionary.wordDefinitions) {
    if (word.length < minLength || word.length > maxLength) continue;
    if (!canBuildWordFromCounts(word, rackCounts)) continue;
    results.push({ word, definition: resolveDefinition(word, dictionary.wordDefinitions), length: word.length });
  }

  return results.sort((left, right) => left.length - right.length || left.word.localeCompare(right.word));
}

export function groupRackWordsByLength(words, minLength, maxLength) {
  const groups = new Map();
  for (let length = minLength; length <= maxLength; length += 1) {
    groups.set(length, []);
  }
  for (const word of words) {
    groups.get(word.length)?.push(word);
  }
  return groups;
}

export function chooseRichRack(dictionary, options = {}) {
  const letterCount = clamp(options.letterCount ?? 6, 3, 10);
  const minLength = clamp(options.minLength ?? 4, 2, letterCount);
  const sampleSize = Math.max(1, options.sampleSize ?? 80);
  const rng = options.rng ?? Math.random;
  const excludedRacks = options.excludedRacks ?? new Set();
  const candidates = [];

  for (const word of dictionary.wordDefinitions.keys()) {
    if (word.length !== letterCount) continue;
    const rack = alphabetize(word);
    if (excludedRacks.has(rack)) continue;
    candidates.push(rack);
  }

  const uniqueCandidates = Array.from(new Set(candidates));
  shuffleInPlace(uniqueCandidates, rng);
  const sampled = uniqueCandidates.slice(0, Math.min(sampleSize, uniqueCandidates.length));
  let best = null;

  for (const sortedRack of sampled) {
    const words = findRackWords(sortedRack, dictionary, { minLength, maxLength: letterCount });
    const fullLengthWords = words.filter((word) => word.length === letterCount).length;
    const score = words.length + fullLengthWords * 2;
    if (!best || score > best.score) {
      best = { sortedRack, words, score };
    }
  }

  if (!best) return null;
  return {
    rack: shuffleString(best.sortedRack, rng),
    sortedRack: best.sortedRack,
    words: best.words
  };
}

export function alphabetize(value) {
  return normalizeRack(value).split("").sort().join("");
}

function countLetters(value) {
  const counts = new Int16Array(26);
  for (const letter of value) counts[letter.charCodeAt(0) - 65] += 1;
  return counts;
}

function canBuildWordFromCounts(word, rackCounts) {
  const used = new Int8Array(26);
  for (const letter of word) {
    const index = letter.charCodeAt(0) - 65;
    used[index] += 1;
    if (used[index] > rackCounts[index]) return false;
  }
  return true;
}

function shuffleString(value, rng) {
  const letters = value.split("");
  shuffleInPlace(letters, rng);
  return letters.join("");
}

function shuffleInPlace(items, rng) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
  return items;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number.parseInt(value, 10) || minimum));
}
