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
import {
  OCR_ROTATIONS,
  chooseBestOcrCandidate,
  lettersToBoardInput
} from "./ocr-utils.js";

const DATA_URL = "./data/nwl2023.txt";
const TESSERACT_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
const OCR_CANVAS_SIZE = 180;

const elements = {
  sizeSelect: document.querySelector("#size-select"),
  boardInput: document.querySelector("#board-input"),
  customMinToggle: document.querySelector("#custom-min-toggle"),
  minLengthInput: document.querySelector("#min-length-input"),
  solveButton: document.querySelector("#solve-button"),
  randomButton: document.querySelector("#random-button"),
  scanButton: document.querySelector("#scan-button"),
  cameraInput: document.querySelector("#camera-input"),
  loadStatus: document.querySelector("#load-status"),
  ocrStatus: document.querySelector("#ocr-status"),
  solveStatus: document.querySelector("#solve-status"),
  board: document.querySelector("#board"),
  definition: document.querySelector("#definition"),
  results: document.querySelector("#results"),
  sortAlpha: document.querySelector("#sort-alpha"),
  sortLength: document.querySelector("#sort-length"),
  cameraPanel: document.querySelector("#camera-panel"),
  cameraVideo: document.querySelector("#camera-video"),
  captureButton: document.querySelector("#capture-button"),
  uploadButton: document.querySelector("#upload-button"),
  closeCameraButton: document.querySelector("#close-camera-button")
};

let dictionary = null;
let currentResults = [];
let selectedWord = null;
let selectedStartIndex = null;
let sortMode = "length";
let cameraStream = null;
let ocrWorkerPromise = null;
let isOcrRunning = false;

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

  elements.scanButton.addEventListener("click", openCameraScanner);
  elements.cameraInput.addEventListener("change", handleCameraInput);
  elements.captureButton.addEventListener("click", captureCameraBoard);
  elements.uploadButton.addEventListener("click", () => elements.cameraInput.click());
  elements.closeCameraButton.addEventListener("click", closeCameraScanner);
  elements.cameraPanel.addEventListener("click", (event) => {
    if (event.target === elements.cameraPanel) {
      closeCameraScanner();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !elements.cameraPanel.hidden) {
      closeCameraScanner();
    }
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

async function openCameraScanner() {
  if (isOcrRunning) return;
  setOcrStatus("");

  if (!navigator.mediaDevices?.getUserMedia) {
    setOcrStatus("Camera stream unavailable; choose a photo.");
    elements.cameraInput.click();
    return;
  }

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 1280 }
      }
    });

    elements.cameraVideo.srcObject = cameraStream;
    elements.cameraPanel.hidden = false;
    await elements.cameraVideo.play();
  } catch (error) {
    closeCameraScanner();
    setOcrStatus("Camera blocked; choose a photo.");
    elements.cameraInput.click();
  }
}

function closeCameraScanner() {
  if (cameraStream) {
    for (const track of cameraStream.getTracks()) {
      track.stop();
    }
  }

  cameraStream = null;
  elements.cameraVideo.srcObject = null;
  elements.cameraPanel.hidden = true;
}

async function captureCameraBoard() {
  if (!elements.cameraVideo.videoWidth || !elements.cameraVideo.videoHeight) {
    setOcrStatus("Camera is still warming up.");
    return;
  }

  const canvas = cropCenterSquare(elements.cameraVideo, 0.82);
  closeCameraScanner();
  await recognizeBoardFromCanvas(canvas);
}

async function handleCameraInput(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;

  closeCameraScanner();

  try {
    const image = await loadImageFromFile(file);
    await recognizeBoardFromCanvas(cropCenterSquare(image, 0.9));
  } catch (error) {
    setOcrStatus(`Could not read image: ${error.message}`);
  }
}

async function recognizeBoardFromCanvas(boardCanvas) {
  if (isOcrRunning) return;

  isOcrRunning = true;
  elements.scanButton.disabled = true;

  try {
    const size = getSize();
    const worker = await getOcrWorker();
    const letters = [];
    const expected = size * size;

    for (let index = 0; index < expected; index += 1) {
      setOcrStatus(`OCR tile ${index + 1}/${expected}...`);
      const cellCanvas = extractBoardCell(boardCanvas, size, index);
      const candidates = [];

      for (const rotation of OCR_ROTATIONS) {
        const tileCanvas = prepareTileForOcr(cellCanvas, rotation);
        const result = await worker.recognize(tileCanvas);
        candidates.push({
          rotation,
          text: result.data?.text || "",
          confidence: result.data?.confidence || 0
        });
      }

      letters.push(chooseBestOcrCandidate(candidates).letter || "E");
    }

    elements.boardInput.value = lettersToBoardInput(letters);
    clearResults();
    renderBoard();
    setOcrStatus(`OCR filled ${letters.length} tiles. Review or edit the letters if needed.`);
    if (dictionary) solveCurrentBoard();
  } catch (error) {
    setOcrStatus(`OCR failed: ${error.message}`);
  } finally {
    isOcrRunning = false;
    elements.scanButton.disabled = false;
  }
}

async function getOcrWorker() {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = (async () => {
      setOcrStatus("Loading OCR engine...");
      await loadTesseract();
      const worker = await window.Tesseract.createWorker("eng");
      await worker.setParameters({
        tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
        tessedit_pageseg_mode: window.Tesseract.PSM?.SINGLE_CHAR || "10"
      });
      return worker;
    })();
  }

  return ocrWorkerPromise;
}

function loadTesseract() {
  if (window.Tesseract) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = TESSERACT_SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not load Tesseract.js"));
    document.head.append(script);
  });
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(image.src);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(image.src);
      reject(new Error("image load failed"));
    };
    image.src = URL.createObjectURL(file);
  });
}

function cropCenterSquare(source, scale = 1) {
  const sourceWidth = source.videoWidth || source.naturalWidth || source.width;
  const sourceHeight = source.videoHeight || source.naturalHeight || source.height;
  const cropSize = Math.min(sourceWidth, sourceHeight) * scale;
  const sx = (sourceWidth - cropSize) / 2;
  const sy = (sourceHeight - cropSize) / 2;
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 1024;
  const context = canvas.getContext("2d");
  context.drawImage(source, sx, sy, cropSize, cropSize, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function extractBoardCell(boardCanvas, size, index) {
  const cellSize = boardCanvas.width / size;
  const column = index % size;
  const row = Math.floor(index / size);
  const padding = cellSize * 0.12;
  const cropSize = cellSize - padding * 2;
  const canvas = document.createElement("canvas");
  canvas.width = OCR_CANVAS_SIZE;
  canvas.height = OCR_CANVAS_SIZE;
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(
    boardCanvas,
    column * cellSize + padding,
    row * cellSize + padding,
    cropSize,
    cropSize,
    0,
    0,
    canvas.width,
    canvas.height
  );
  return canvas;
}

function prepareTileForOcr(cellCanvas, rotation) {
  const canvas = document.createElement("canvas");
  canvas.width = OCR_CANVAS_SIZE;
  canvas.height = OCR_CANVAS_SIZE;
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate((rotation * Math.PI) / 180);
  context.drawImage(cellCanvas, -canvas.width / 2, -canvas.height / 2, canvas.width, canvas.height);

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < imageData.data.length; index += 4) {
    const red = imageData.data[index];
    const green = imageData.data[index + 1];
    const blue = imageData.data[index + 2];
    const gray = red * 0.299 + green * 0.587 + blue * 0.114;
    const contrasted = Math.max(0, Math.min(255, (gray - 128) * 1.8 + 128));
    imageData.data[index] = contrasted;
    imageData.data[index + 1] = contrasted;
    imageData.data[index + 2] = contrasted;
  }
  context.putImageData(imageData, 0, 0);

  return canvas;
}

function setOcrStatus(message) {
  elements.ocrStatus.textContent = message;
  elements.ocrStatus.hidden = !message;
}
