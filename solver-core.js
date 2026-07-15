export const MIN_ALLOWED_WORD_LENGTH = 2;
export const MIN_BOGGLE_WORD_LENGTH = 3;

export const SAMPLE_BOARD_5 = "TOQHITSTGODAEERNFSLTTRUNR";

const DICE_BY_SIZE = {
  4: [
    "AAEEGN",
    "ABBJOO",
    "ACHOPS",
    "AFFKPS",
    "AOOTTW",
    "CIMOTU",
    "DEILRX",
    "DELRVY",
    "DISTTY",
    "EEGHNW",
    "EEINSU",
    "EHRTVW",
    "EIOSST",
    "ELRTTY",
    "HIMNQU",
    "HLNNRZ"
  ],
  5: [
    "AAAFRS",
    "AAEEEE",
    "AAFIRS",
    "ADENNN",
    "AEEEEM",
    "AEEGMU",
    "AEGMNN",
    "AFIRSY",
    "BJKQXZ",
    "CCENST",
    "CEIILT",
    "CEILPT",
    "CEIPST",
    "DDLNOR",
    "DHHLOR",
    "DHHNOT",
    "DHLNOR",
    "EIIITT",
    "EMOTTT",
    "ENSSSU",
    "FIPRSY",
    "GORRVW",
    "HIPRRY",
    "NOOTUW",
    "OOOTTU"
  ]
};

const FALLBACK_LETTERS = "EEEEEEEEEEEEAAAAAAAAAIIIIIIIIOOOOOOOONNNNNNRRRRRRTTTTTTLLLLSSSSUUUUDDDDGGGBBCCMMPPFFHHVVWWYYKJXQZ";

export function parseDictionaryText(text, options = {}) {
  const minLength = options.minLength ?? MIN_BOGGLE_WORD_LENGTH;
  const root = createTrieNode();
  const wordDefinitions = new Map();
  let maxWordLength = 0;
  let playableEntries = 0;
  let totalEntries = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const firstSpace = line.indexOf(" ");
    if (firstSpace < 1) continue;

    const word = line.slice(0, firstSpace).trim();
    const definition = line.slice(firstSpace + 1).trim();

    if (!/^[A-Z]+$/.test(word)) continue;

    totalEntries += 1;
    wordDefinitions.set(word, definition);

    if (word.length < minLength) continue;

    playableEntries += 1;
    addWordToTrie(root, word);
    maxWordLength = Math.max(maxWordLength, word.length);
  }

  return {
    root,
    wordDefinitions,
    maxWordLength,
    playableEntries,
    totalEntries
  };
}

export function parseBoardInput(rawValue, size) {
  const expected = size * size;
  const normalized = String(rawValue || "").toUpperCase().replace(/[^A-Z]/g, "");
  const greedyTiles = tokenizeBoardLetters(normalized, true);
  const fallbackTiles = tokenizeBoardLetters(normalized, false);
  const tiles = greedyTiles.length === expected ? greedyTiles : fallbackTiles;

  return {
    expected,
    isComplete: tiles.length === expected,
    normalized,
    tiles
  };
}

export function tilesToInput(tiles) {
  return tiles.map((tile) => (tile === "QU" ? "Q" : tile)).join("");
}

export function randomBoard(size, rng = Math.random) {
  const dice = DICE_BY_SIZE[size];
  if (dice) {
    return shuffle(dice, rng).map((die) => normalizeTile(die[Math.floor(rng() * die.length)]));
  }

  return Array.from({ length: size * size }, () => {
    const letter = FALLBACK_LETTERS[Math.floor(rng() * FALLBACK_LETTERS.length)];
    return normalizeTile(letter);
  });
}

export function chooseRichBoggleBoard(dictionary, options = {}) {
  const size = Number(options.size) || 4;
  const minLength = Number(options.minLength) || MIN_BOGGLE_WORD_LENGTH;
  const sampleSize = Math.max(1, Number(options.sampleSize) || 16);
  const targetWords = Number(options.targetWords) || ({ 4: 100, 5: 300, 6: 400 }[size] ?? 100);
  const rng = options.rng || Math.random;
  const excludedBoards = options.excludedBoards || new Set();
  const createBoard = options.createBoard || randomBoard;
  let best = null;

  for (let sample = 0; sample < sampleSize; sample += 1) {
    const tiles = createBoard(size, rng);
    const boardKey = tilesToInput(tiles);
    if (excludedBoards.has(boardKey)) continue;
    const words = solveBoard(tiles, size, dictionary, { minLength });
    const totalPoints = words.reduce((sum, word) => sum + word.score, 0);
    const score = -Math.abs(words.length - targetWords) + totalPoints * 0.0001;
    if (!best || score > best.score) {
      best = { tiles, boardKey, words, totalPoints, score };
    }
  }

  return best;
}

export function solveBoard(tiles, size, dictionary, options = {}) {
  const minLength = options.minLength ?? MIN_BOGGLE_WORD_LENGTH;
  const found = new Map();
  const neighbors = buildNeighbors(size);
  const visited = Array.from({ length: tiles.length }, () => false);
  const root = dictionary.root;
  const maxWordLength = dictionary.maxWordLength;

  for (let index = 0; index < tiles.length; index += 1) {
    walk(index, root, "", []);
  }

  return Array.from(found.values());

  function walk(index, node, word, path) {
    const tile = tiles[index];
    const nextNode = advanceTrie(node, tile);
    if (!nextNode) return;

    const nextWord = word + tile;
    if (nextWord.length > maxWordLength) return;

    const nextPath = path.concat(index);
    if (nextNode.word && nextWord.length >= minLength && !found.has(nextWord)) {
      found.set(nextWord, {
        word: nextWord,
        definition: resolveDefinition(nextWord, dictionary.wordDefinitions),
        score: scoreWord(nextWord),
        path: nextPath
      });
    }

    if (nextWord.length >= maxWordLength) return;

    visited[index] = true;
    for (const nextIndex of neighbors[index]) {
      if (!visited[nextIndex]) {
        walk(nextIndex, nextNode, nextWord, nextPath);
      }
    }
    visited[index] = false;
  }
}

export function resolveDefinition(word, wordDefinitions, seen = new Set()) {
  const rawDefinition = wordDefinitions.get(word) || "";
  const references = Array.from(rawDefinition.matchAll(/[<{]([A-Za-z]+)=[^>}]+[>}]/g));
  if (references.length === 0) return rawDefinition;

  const readable = rawDefinition.replace(/[<{]([A-Za-z]+)=[^>}]+[>}]/g, (_, base) => base.toUpperCase());
  const startsWithReference = references[0].index === 0;
  if (startsWithReference) {
    const baseWord = references[0][1].toUpperCase();
    if (baseWord !== word && !seen.has(baseWord) && wordDefinitions.has(baseWord)) {
      return resolveDefinition(baseWord, wordDefinitions, new Set([...seen, word]));
    }
    return readable;
  }

  const lead = startsWithReference ? `Alternative form of ${readable}` : readable;
  const explanations = [];

  seen.add(word);
  for (const reference of references) {
    const baseWord = reference[1].toUpperCase();
    if (baseWord === word || seen.has(baseWord) || !wordDefinitions.has(baseWord)) continue;
    explanations.push(`${baseWord}: ${resolveDefinition(baseWord, wordDefinitions, new Set(seen))}`);
  }

  return explanations.length ? `${lead} — ${explanations.join(" / ")}` : lead;
}

export function scoreWord(word) {
  const length = word.length;
  if (length < MIN_BOGGLE_WORD_LENGTH) return 0;
  if (length <= 4) return 1;
  if (length === 5) return 2;
  if (length === 6) return 3;
  if (length === 7) return 5;
  return 11;
}

export function compareByAlpha(a, b) {
  return a.word.localeCompare(b.word);
}

export function compareByLength(a, b) {
  return b.word.length - a.word.length || a.word.localeCompare(b.word);
}

export function displayTile(tile) {
  return tile === "QU" ? "Qu" : tile;
}

function createTrieNode() {
  return {
    children: Object.create(null),
    word: null
  };
}

function addWordToTrie(root, word) {
  let node = root;
  for (const letter of word) {
    node.children[letter] ||= createTrieNode();
    node = node.children[letter];
  }
  node.word = word;
}

function advanceTrie(node, tile) {
  let cursor = node;
  for (const letter of tile) {
    cursor = cursor.children[letter];
    if (!cursor) return null;
  }
  return cursor;
}

function tokenizeBoardLetters(value, collapseQu) {
  const tiles = [];
  for (let index = 0; index < value.length; index += 1) {
    const letter = value[index];
    if (letter === "Q") {
      if (collapseQu && value[index + 1] === "U") {
        index += 1;
      }
      tiles.push("QU");
    } else {
      tiles.push(letter);
    }
  }
  return tiles;
}

function normalizeTile(letter) {
  return letter === "Q" ? "QU" : letter;
}

function shuffle(items, rng) {
  const shuffled = items.slice();
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function buildNeighbors(size) {
  return Array.from({ length: size * size }, (_, index) => {
    const row = Math.floor(index / size);
    const column = index % size;
    const indexes = [];

    for (let rowDelta = -1; rowDelta <= 1; rowDelta += 1) {
      for (let columnDelta = -1; columnDelta <= 1; columnDelta += 1) {
        if (rowDelta === 0 && columnDelta === 0) continue;
        const nextRow = row + rowDelta;
        const nextColumn = column + columnDelta;
        if (nextRow >= 0 && nextRow < size && nextColumn >= 0 && nextColumn < size) {
          indexes.push(nextRow * size + nextColumn);
        }
      }
    }

    return indexes;
  });
}
