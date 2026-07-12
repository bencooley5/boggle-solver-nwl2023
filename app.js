import {
  MIN_ALLOWED_WORD_LENGTH,
  MIN_BOGGLE_WORD_LENGTH,
  SAMPLE_BOARD_5,
  compareByAlpha,
  compareByLength,
  displayTile,
  parseBoardInput,
  parseDictionaryText,
  randomBoard,
  solveBoard,
  tilesToInput
} from "./solver-core.js";

const DATA_URL = "./data/nwl2023.txt";

const elements = {
  sizeSelect: document.querySelector("#size-select"),
  boardInput: document.querySelector("#board-input"),
  customMinToggle: document.querySelector("#custom-min-toggle"),
  minLengthInput: document.querySelector("#min-length-input"),
  solveButton: document.querySelector("#solve-button"),
  randomButton: document.querySelector("#random-button"),
  loadStatus: document.querySelector("#load-status"),
  solveStatus: document.querySelector("#solve-status"),
  board: document.querySelector("#board"),
  definition: document.querySelector("#definition"),
  results: document.querySelector("#results"),
  sortAlpha: document.querySelector("#sort-alpha"),
  sortLength: document.querySelector("#sort-length")
};

let dictionary = null;
let currentResults = [];
let selectedWord = null;
let selectedStartIndex = null;
let sortMode = "length";

boot();

async function boot() {
  elements.boardInput.value = SAMPLE_BOARD_5;
  renderBoard();
  bindEvents();

  try {
    const response = await fetch(DATA_URL);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const dictionaryText = await response.text();
    const startedAt = performance.now();
    dictionary = parseDictionaryText(dictionaryText, { minLength: MIN_ALLOWED_WORD_LENGTH });
    const parseMs = Math.round(performance.now() - startedAt);

    elements.loadStatus.textContent = `Indexed ${dictionary.playableEntries.toLocaleString()} NWL2023 words with definitions in ${parseMs.toLocaleString()} ms.`;
    elements.solveButton.disabled = false;
    solveCurrentBoard();
  } catch (error) {
    elements.loadStatus.textContent = "Could not load data/nwl2023.txt. Start the local server with npm start and open the localhost URL.";
    elements.solveStatus.textContent = error.message;
  }
}

function bindEvents() {
  elements.sizeSelect.addEventListener("change", () => {
    const size = getSize();
    if (size === 5) {
      elements.boardInput.value = SAMPLE_BOARD_5;
    } else {
      elements.boardInput.value = tilesToInput(randomBoard(size));
    }
    clearResults();
    renderBoard();
  });

  elements.boardInput.addEventListener("input", () => {
    clearResults();
    renderBoard();
  });

  elements.solveButton.addEventListener("click", solveCurrentBoard);

  elements.customMinToggle.addEventListener("change", () => {
    updateMinimumControl();
    if (dictionary) solveCurrentBoard();
  });

  elements.minLengthInput.addEventListener("input", () => {
    if (dictionary && elements.customMinToggle.checked) solveCurrentBoard();
  });

  elements.minLengthInput.addEventListener("change", () => {
    clampMinimumInput();
    if (dictionary && elements.customMinToggle.checked) solveCurrentBoard();
  });

  elements.randomButton.addEventListener("click", () => {
    elements.boardInput.value = tilesToInput(randomBoard(getSize()));
    clearResults();
    renderBoard();
    if (dictionary) solveCurrentBoard();
  });

  elements.sortAlpha.addEventListener("click", () => {
    sortMode = "alpha";
    updateSortButtons();
    renderResults();
  });

  elements.sortLength.addEventListener("click", () => {
    sortMode = "length";
    updateSortButtons();
    renderResults();
  });
}

function solveCurrentBoard() {
  if (!dictionary) return;

  const size = getSize();
  const parsed = parseBoardInput(elements.boardInput.value, size);
  if (!parsed.isComplete) {
    elements.solveStatus.textContent = `Need ${parsed.expected} tiles for a ${size}x${size} board; found ${parsed.tiles.length}.`;
    renderBoard(parsed.tiles);
    clearResults(false);
    return;
  }

  renderBoard(parsed.tiles);
  const minLength = getMinimumWordLength();
  const startedAt = performance.now();
  currentResults = solveBoard(parsed.tiles, size, dictionary, { minLength });
  const elapsedMs = Math.round(performance.now() - startedAt);
  const points = currentResults.reduce((sum, result) => sum + result.score, 0);

  elements.solveStatus.dataset.baseText = `found ${currentResults.length.toLocaleString()} words of ${minLength}+ letters in ${elapsedMs.toLocaleString()} ms for ${points.toLocaleString()} points`;
  selectedStartIndex = null;
  selectedWord = getSortedResults()[0]?.word || null;
  renderResults();
  renderBoard(parsed.tiles);
  renderDefinition();
}

function getSize() {
  return Number(elements.sizeSelect.value);
}

function getMinimumWordLength() {
  if (!elements.customMinToggle.checked) return MIN_BOGGLE_WORD_LENGTH;
  return readMinimumInput();
}

function readMinimumInput() {
  const value = Number.parseInt(elements.minLengthInput.value, 10);
  return Math.min(36, Math.max(MIN_ALLOWED_WORD_LENGTH, Number.isFinite(value) ? value : MIN_BOGGLE_WORD_LENGTH));
}

function clampMinimumInput() {
  const minimum = readMinimumInput();
  elements.minLengthInput.value = String(minimum);
  return minimum;
}

function updateMinimumControl() {
  const isCustom = elements.customMinToggle.checked;
  elements.minLengthInput.disabled = !isCustom;
  if (!isCustom) {
    elements.minLengthInput.value = String(MIN_BOGGLE_WORD_LENGTH);
  } else {
    clampMinimumInput();
  }
}

function getSortedResults() {
  return getFilteredResults().sort(sortMode === "alpha" ? compareByAlpha : compareByLength);
}

function getFilteredResults() {
  const results = currentResults.slice();
  if (selectedStartIndex === null) return results;
  return results.filter((result) => result.path[0] === selectedStartIndex);
}

function renderResults() {
  const sortedResults = getSortedResults();
  if (selectedWord && !sortedResults.some((result) => result.word === selectedWord)) {
    selectedWord = sortedResults[0]?.word || null;
  }
  elements.results.replaceChildren();
  renderSolveStatus(sortedResults);

  if (sortedResults.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-results";
    empty.textContent = dictionary ? "No words found." : "Dictionary is loading...";
    elements.results.append(empty);
    renderDefinition();
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const result of sortedResults) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "word-pill";
    button.textContent = result.word;
    button.dataset.word = result.word;
    if (result.word === selectedWord) {
      button.classList.add("is-selected");
    }
    button.addEventListener("click", () => {
      selectedWord = result.word;
      renderResults();
      renderBoard();
      renderDefinition();
    });
    fragment.append(button);
  }

  elements.results.append(fragment);
  renderDefinition();
}

function renderBoard(forcedTiles = null) {
  const size = getSize();
  const parsed = parseBoardInput(elements.boardInput.value, size);
  const tiles = forcedTiles || parsed.tiles;
  const selected = currentResults.find((result) => result.word === selectedWord);
  const pathSteps = new Map((selected?.path || []).map((index, step) => [index, step + 1]));

  elements.board.style.setProperty("--board-size", size);
  elements.board.replaceChildren();

  for (let index = 0; index < size * size; index += 1) {
    const tile = tiles[index] || "";
    const cell = document.createElement("div");
    cell.className = "tile";
    cell.dataset.index = String(index);
    cell.setAttribute("role", "button");
    cell.setAttribute("tabindex", tile ? "0" : "-1");
    cell.setAttribute("aria-label", tile ? `Filter words starting at ${displayTile(tile)} tile ${index + 1}` : `Empty tile ${index + 1}`);
    if (!tile) cell.classList.add("is-empty");
    if (pathSteps.has(index)) cell.classList.add("is-path");
    if (selectedStartIndex === index) cell.classList.add("is-start-filter");

    if (tile) {
      cell.addEventListener("click", () => toggleStartFilter(index));
      cell.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          toggleStartFilter(index);
        }
      });
    }

    const step = document.createElement("span");
    step.className = "tile-step";
    step.textContent = pathSteps.get(index) || "";

    const letter = document.createElement("span");
    letter.className = "tile-letter";
    letter.textContent = tile ? displayTile(tile) : "";

    cell.append(step, letter);
    elements.board.append(cell);
  }
}

function toggleStartFilter(index) {
  selectedStartIndex = selectedStartIndex === index ? null : index;
  selectedWord = getSortedResults()[0]?.word || null;
  renderResults();
  renderBoard();
  renderDefinition();
}

function renderSolveStatus(visibleResults = getFilteredResults()) {
  const baseText = elements.solveStatus.dataset.baseText || "Ready.";
  if (selectedStartIndex === null) {
    elements.solveStatus.textContent = baseText;
    return;
  }

  const size = getSize();
  const parsed = parseBoardInput(elements.boardInput.value, size);
  const tile = parsed.tiles[selectedStartIndex] || "";
  elements.solveStatus.textContent = `${baseText} - showing ${visibleResults.length.toLocaleString()} from ${displayTile(tile)} tile ${selectedStartIndex + 1}`;
}

function renderDefinition() {
  const result = currentResults.find((item) => item.word === selectedWord);
  if (!result) {
    elements.definition.textContent = "";
    return;
  }

  const pointsLabel = result.score === 1 ? "point" : "points";
  elements.definition.textContent = `${result.word} (${result.score} Boggle ${pointsLabel}): ${result.definition}`;
}

function clearResults(clearStatus = true) {
  currentResults = [];
  selectedWord = null;
  selectedStartIndex = null;
  elements.results.replaceChildren();
  elements.definition.textContent = "";
  if (clearStatus) {
    elements.solveStatus.textContent = "Ready.";
    elements.solveStatus.dataset.baseText = "Ready.";
  }
}

function updateSortButtons() {
  elements.sortAlpha.classList.toggle("is-active", sortMode === "alpha");
  elements.sortLength.classList.toggle("is-active", sortMode === "length");
}
