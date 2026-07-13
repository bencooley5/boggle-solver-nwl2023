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
  isWeakOcrCandidate,
  lettersToBoardInput,
  normalizeOcrLetter,
  rotateBoardLetters
} from "./ocr-utils.js";
import { PHOTO_DICE_TEMPLATE_MASKS } from "./ocr-photo-templates.js?v=ocr10";

const DATA_URL = "./data/nwl2023.txt";
const TESSERACT_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
const HEIC_CONVERTER_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js";
const OCR_CANVAS_SIZE = 180;
const OCR_MASK_SIZE = 64;
const OCR_TEMPLATE_LABELS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").concat("QU");
const OCR_TEMPLATE_FONTS = [
  "Arial",
  "Verdana",
  "Georgia",
  "Impact"
];

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
  closeCameraButton: document.querySelector("#close-camera-button"),
  ocrReviewPanel: document.querySelector("#ocr-review-panel"),
  ocrReviewGrid: document.querySelector("#ocr-review-grid"),
  applyOcrButton: document.querySelector("#apply-ocr-button"),
  rotateOcrLeftButton: document.querySelector("#rotate-ocr-left-button"),
  rotateOcrRightButton: document.querySelector("#rotate-ocr-right-button"),
  closeOcrReviewButton: document.querySelector("#close-ocr-review-button")
};

let dictionary = null;
let currentResults = [];
let selectedWord = null;
let selectedStartIndex = null;
let sortMode = "length";
let cameraStream = null;
let ocrWorkerPromise = null;
let heicConverterPromise = null;
let isOcrRunning = false;
let lastOcrResults = [];
let templateMasks = null;
let decodedPhotoTemplateMasks = null;

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
  elements.applyOcrButton.addEventListener("click", applyOcrReview);
  elements.rotateOcrLeftButton.addEventListener("click", () => rotateOcrReview("counterclockwise"));
  elements.rotateOcrRightButton.addEventListener("click", () => rotateOcrReview("clockwise"));
  elements.closeOcrReviewButton.addEventListener("click", () => {
    elements.ocrReviewPanel.hidden = true;
  });
  elements.cameraPanel.addEventListener("click", (event) => {
    if (event.target === elements.cameraPanel) {
      closeCameraScanner();
    }
  });
  elements.ocrReviewPanel.addEventListener("click", (event) => {
    if (event.target === elements.ocrReviewPanel) {
      elements.ocrReviewPanel.hidden = true;
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !elements.cameraPanel.hidden) {
      closeCameraScanner();
    }
    if (event.key === "Escape" && !elements.ocrReviewPanel.hidden) {
      elements.ocrReviewPanel.hidden = true;
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

  const canvas = cropCenterSquare(elements.cameraVideo, 0.92);
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
    await recognizeBoardFromCanvas(image);
  } catch (error) {
    setOcrStatus(`Could not read image: ${error.message}`);
  }
}

async function recognizeBoardFromCanvas(source) {
  if (isOcrRunning) return;

  isOcrRunning = true;
  elements.scanButton.disabled = true;

  try {
    const size = getSize();
    const dieCells = extractDieFaceCells(source, size);
    const boardCanvas = dieCells ? null : cropLikelyBoard(source);
    const extractionMode = dieCells ? "detected dice faces" : "fallback grid";
    const ocrResults = [];
    const expected = size * size;

    for (let index = 0; index < expected; index += 1) {
      const cellCanvas = dieCells?.[index] || extractBoardCell(boardCanvas, size, index);
      let bestCandidate = guessTileWithTemplates(cellCanvas);

      if (isWeakOcrCandidate(bestCandidate)) {
        setOcrStatus(`OCR tile ${index + 1}/${expected}...`);
        const worker = await getOcrWorker();
        const candidates = [bestCandidate];

        for (const inkMode of ["red", "gray"]) {
          for (const rotation of OCR_ROTATIONS) {
            const tileCanvas = prepareTileForOcr(cellCanvas, rotation, inkMode);
            const result = await worker.recognize(tileCanvas);
            candidates.push({
              rotation,
              text: result.data?.text || "",
              confidence: result.data?.confidence || 0,
              source: "tesseract",
              inkMode
            });
          }
        }

        bestCandidate = chooseBestOcrCandidate(candidates);
      } else {
        setOcrStatus(`Matched tile ${index + 1}/${expected}...`);
      }

      ocrResults.push({
        ...bestCandidate,
        index,
        letter: bestCandidate.letter || "E"
      });
    }

    applyOcrResults(ocrResults);
    renderOcrReview(lastOcrResults);
    const weakCount = lastOcrResults.filter(isWeakOcrCandidate).length;
    setOcrStatus(`OCR filled ${ocrResults.length} tiles from ${extractionMode}. Review the scan${weakCount ? `; ${weakCount} low-confidence guesses are marked.` : "."}`);
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

async function loadImageFromFile(file) {
  try {
    return await loadImageFromBlob(file);
  } catch (error) {
    if (!isHeicFile(file)) {
      throw error;
    }
  }

  setOcrStatus("Converting HEIC photo...");
  const heic2any = await getHeicConverter();
  const converted = await heic2any({
    blob: file,
    toType: "image/jpeg",
    quality: 0.92
  });
  const convertedBlob = Array.isArray(converted) ? converted[0] : converted;
  return loadImageFromBlob(convertedBlob);
}

async function loadImageFromBlob(blob) {
  if (window.createImageBitmap) {
    try {
      const bitmap = await window.createImageBitmap(blob, { imageOrientation: "from-image" });
      return imageBitmapToCanvas(bitmap);
    } catch (error) {
      // Some browsers cannot decode HEIC or honor image bitmap options; fall back to Image.
    }
  }

  return loadHtmlImageFromBlob(blob);
}

function imageBitmapToCanvas(bitmap) {
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d");
  context.imageSmoothingEnabled = false;
  context.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  return canvas;
}

function loadHtmlImageFromBlob(blob) {
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
    image.src = URL.createObjectURL(blob);
  });
}

function isHeicFile(file) {
  return /hei[cf]/i.test(file.type) || /\.(hei[cf])$/i.test(file.name || "");
}

async function getHeicConverter() {
  if (!heicConverterPromise) {
    heicConverterPromise = new Promise((resolve, reject) => {
      if (window.heic2any) {
        resolve(window.heic2any);
        return;
      }

      const script = document.createElement("script");
      script.src = HEIC_CONVERTER_SCRIPT_URL;
      script.async = true;
      script.onload = () => {
        if (window.heic2any) {
          resolve(window.heic2any);
        } else {
          reject(new Error("HEIC converter unavailable"));
        }
      };
      script.onerror = () => reject(new Error("Could not load HEIC converter"));
      document.head.append(script);
    });
  }

  return heicConverterPromise;
}

function extractDieFaceCells(source, size) {
  const sourceWidth = source.videoWidth || source.naturalWidth || source.width;
  const sourceHeight = source.videoHeight || source.naturalHeight || source.height;
  const scanScale = Math.min(1, 1000 / Math.max(sourceWidth, sourceHeight));
  const scanCanvas = document.createElement("canvas");
  scanCanvas.width = Math.max(1, Math.round(sourceWidth * scanScale));
  scanCanvas.height = Math.max(1, Math.round(sourceHeight * scanScale));
  const scanContext = scanCanvas.getContext("2d", { willReadFrequently: true });
  scanContext.imageSmoothingEnabled = false;
  scanContext.drawImage(source, 0, 0, scanCanvas.width, scanCanvas.height);
  const imageData = scanContext.getImageData(0, 0, scanCanvas.width, scanCanvas.height);
  const mask = new Uint8Array(scanCanvas.width * scanCanvas.height);
  const seen = new Uint8Array(mask.length);

  for (let y = 0; y < scanCanvas.height; y += 1) {
    for (let x = 0; x < scanCanvas.width; x += 1) {
      const dataIndex = (y * scanCanvas.width + x) * 4;
      if (isTileFacePixel(imageData.data[dataIndex], imageData.data[dataIndex + 1], imageData.data[dataIndex + 2])) {
        mask[y * scanCanvas.width + x] = 1;
      }
    }
  }

  const components = findTileFaceComponents(mask, scanCanvas.width, scanCanvas.height)
    .filter((component) => isPlausibleDieFace(component, scanCanvas.width, scanCanvas.height))
    .sort((left, right) => right.count - left.count)
    .slice(0, size * size);

  if (components.length !== size * size) return null;

  const rows = groupDieComponentsIntoRows(components, size);
  if (!rows) return null;

  return rows.flatMap((row) => row.map((component) => cropDieFaceCell(source, component, scanScale)));
}

function findTileFaceComponents(mask, width, height) {
  const seen = new Uint8Array(mask.length);
  const stack = [];
  const components = [];

  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index] || seen[index]) continue;

    const startX = index % width;
    const startY = Math.floor(index / width);
    const component = {
      count: 0,
      minX: startX,
      minY: startY,
      maxX: startX,
      maxY: startY,
      sumX: 0,
      sumY: 0
    };

    stack.length = 0;
    stack.push(index);
    seen[index] = 1;

    while (stack.length) {
      const current = stack.pop();
      const x = current % width;
      const y = Math.floor(current / width);
      component.count += 1;
      component.sumX += x;
      component.sumY += y;
      component.minX = Math.min(component.minX, x);
      component.minY = Math.min(component.minY, y);
      component.maxX = Math.max(component.maxX, x);
      component.maxY = Math.max(component.maxY, y);

      addTileNeighbor(mask, seen, stack, current - 1, width, height, x - 1, y);
      addTileNeighbor(mask, seen, stack, current + 1, width, height, x + 1, y);
      addTileNeighbor(mask, seen, stack, current - width, width, height, x, y - 1);
      addTileNeighbor(mask, seen, stack, current + width, width, height, x, y + 1);
    }

    component.width = component.maxX - component.minX + 1;
    component.height = component.maxY - component.minY + 1;
    component.cx = component.sumX / component.count;
    component.cy = component.sumY / component.count;
    components.push(component);
  }

  return components;
}

function addTileNeighbor(mask, seen, stack, index, width, height, x, y) {
  if (x < 0 || x >= width || y < 0 || y >= height || index < 0 || index >= mask.length) return;
  if (!mask[index] || seen[index]) return;
  seen[index] = 1;
  stack.push(index);
}

function isPlausibleDieFace(component, width, height) {
  const imageArea = width * height;
  const areaRatio = component.count / imageArea;
  const aspect = component.width / component.height;

  return areaRatio > 0.004 &&
    areaRatio < 0.04 &&
    aspect > 0.55 &&
    aspect < 1.6 &&
    component.width > width * 0.045 &&
    component.height > height * 0.045;
}

function groupDieComponentsIntoRows(components, size) {
  const sorted = components.slice().sort((left, right) => left.cy - right.cy);
  const rows = [];

  for (let index = 0; index < sorted.length; index += size) {
    const row = sorted.slice(index, index + size).sort((left, right) => left.cx - right.cx);
    if (row.length !== size) return null;
    rows.push(row);
  }

  return rows.length === size ? rows : null;
}

function cropDieFaceCell(source, component, scanScale) {
  const sourceWidth = source.videoWidth || source.naturalWidth || source.width;
  const sourceHeight = source.videoHeight || source.naturalHeight || source.height;
  const padX = component.width * 0.08;
  const padY = component.height * 0.08;
  const sx = Math.max(0, (component.minX - padX) / scanScale);
  const sy = Math.max(0, (component.minY - padY) / scanScale);
  const sw = Math.min(sourceWidth - sx, (component.width + padX * 2) / scanScale);
  const sh = Math.min(sourceHeight - sy, (component.height + padY * 2) / scanScale);
  const canvas = document.createElement("canvas");
  canvas.width = OCR_CANVAS_SIZE;
  canvas.height = OCR_CANVAS_SIZE;
  const context = canvas.getContext("2d");
  context.imageSmoothingEnabled = false;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  canvas.ocrPreferPhoto = true;
  return canvas;
}

function cropLikelyBoard(source) {
  const tileCrop = cropLightTileGrid(source);
  if (tileCrop) return tileCrop;
  return cropCenterSquare(source, 0.9);
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
  canvas.ocrCellPadding = 0.18;
  return canvas;
}

function cropLightTileGrid(source) {
  const sourceWidth = source.videoWidth || source.naturalWidth || source.width;
  const sourceHeight = source.videoHeight || source.naturalHeight || source.height;
  const scanScale = Math.min(1, 900 / Math.max(sourceWidth, sourceHeight));
  const scanCanvas = document.createElement("canvas");
  scanCanvas.width = Math.max(1, Math.round(sourceWidth * scanScale));
  scanCanvas.height = Math.max(1, Math.round(sourceHeight * scanScale));
  const scanContext = scanCanvas.getContext("2d", { willReadFrequently: true });
  scanContext.imageSmoothingEnabled = false;
  scanContext.drawImage(source, 0, 0, scanCanvas.width, scanCanvas.height);
  const imageData = scanContext.getImageData(0, 0, scanCanvas.width, scanCanvas.height);
  let minX = scanCanvas.width;
  let minY = scanCanvas.height;
  let maxX = -1;
  let maxY = -1;
  let pixels = 0;

  for (let y = 0; y < scanCanvas.height; y += 1) {
    for (let x = 0; x < scanCanvas.width; x += 1) {
      const index = (y * scanCanvas.width + x) * 4;
      const red = imageData.data[index];
      const green = imageData.data[index + 1];
      const blue = imageData.data[index + 2];
      if (!isTileFacePixel(red, green, blue)) continue;

      pixels += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const minimumPixels = scanCanvas.width * scanCanvas.height * 0.08;
  if (!pixels || pixels < minimumPixels || width < scanCanvas.width * 0.35 || height < scanCanvas.height * 0.35) {
    return null;
  }

  const padX = width * 0.045;
  const padY = height * 0.045;
  const sx = Math.max(0, (minX - padX) / scanScale);
  const sy = Math.max(0, (minY - padY) / scanScale);
  const sw = Math.min(sourceWidth - sx, (width + padX * 2) / scanScale);
  const sh = Math.min(sourceHeight - sy, (height + padY * 2) / scanScale);
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 1024;
  const context = canvas.getContext("2d");
  context.imageSmoothingEnabled = false;
  context.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  canvas.ocrCellPadding = 0.08;
  return canvas;
}

function isTileFacePixel(red, green, blue) {
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  return red > 155 &&
    green > 140 &&
    blue > 115 &&
    max - min < 92 &&
    red - green < 68 &&
    green - blue < 72 &&
    red - blue < 105;
}

function extractBoardCell(boardCanvas, size, index) {
  const cellSize = boardCanvas.width / size;
  const column = index % size;
  const row = Math.floor(index / size);
  const padding = cellSize * (boardCanvas.ocrCellPadding ?? 0.18);
  const cropSize = cellSize - padding * 2;
  const canvas = document.createElement("canvas");
  canvas.width = OCR_CANVAS_SIZE;
  canvas.height = OCR_CANVAS_SIZE;
  const context = canvas.getContext("2d");
  context.imageSmoothingEnabled = false;
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

function prepareTileForOcr(cellCanvas, rotation, inkMode = "gray") {
  const canvas = document.createElement("canvas");
  canvas.width = OCR_CANVAS_SIZE;
  canvas.height = OCR_CANVAS_SIZE;
  const context = canvas.getContext("2d");
  context.imageSmoothingEnabled = false;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate((rotation * Math.PI) / 180);
  context.drawImage(cellCanvas, -canvas.width / 2, -canvas.height / 2, canvas.width, canvas.height);

  if (inkMode === "red") {
    isolateRedInk(canvas);
  } else {
    enhanceTileCanvas(canvas);
  }
  return canvas;
}

function isolateRedInk(canvas) {
  const context = canvas.getContext("2d");
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);

  for (let index = 0; index < imageData.data.length; index += 4) {
    const red = imageData.data[index];
    const green = imageData.data[index + 1];
    const blue = imageData.data[index + 2];
    const gray = red * 0.299 + green * 0.587 + blue * 0.114;
    const isRedInk = red > 75 && red - green > 28 && red - blue > 18 && gray < 190;
    const value = isRedInk ? 0 : 255;
    imageData.data[index] = value;
    imageData.data[index + 1] = value;
    imageData.data[index + 2] = value;
  }

  context.putImageData(imageData, 0, 0);
}

function enhanceTileCanvas(canvas) {
  const context = canvas.getContext("2d");
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const grays = [];

  for (let index = 0; index < imageData.data.length; index += 4) {
    const red = imageData.data[index];
    const green = imageData.data[index + 1];
    const blue = imageData.data[index + 2];
    const gray = red * 0.299 + green * 0.587 + blue * 0.114;
    grays.push(gray);
  }

  const threshold = getOtsuThreshold(grays);
  for (let index = 0; index < imageData.data.length; index += 4) {
    const red = imageData.data[index];
    const green = imageData.data[index + 1];
    const blue = imageData.data[index + 2];
    const gray = red * 0.299 + green * 0.587 + blue * 0.114;
    const value = gray < threshold ? 0 : 255;
    imageData.data[index] = value;
    imageData.data[index + 1] = value;
    imageData.data[index + 2] = value;
  }
  context.putImageData(imageData, 0, 0);
}

function guessTileWithTemplates(cellCanvas) {
  const photoCandidate = guessTileWithTemplateSet(cellCanvas, getPhotoTemplateMasks(), "photo-template");
  const photoThreshold = cellCanvas.ocrPreferPhoto ? 0.42 : 0.56;
  if (photoCandidate.score >= photoThreshold) {
    return photoCandidate;
  }

  return guessTileWithTemplateSet(cellCanvas, getTemplateMasks(), "template");
}

function guessTileWithTemplateSet(cellCanvas, templates, source) {
  let best = null;
  let secondScore = 0;
  const inkModes = source === "photo-template" ? ["red"] : ["red", "gray"];

  for (const inkMode of inkModes) {
    for (const rotation of OCR_ROTATIONS) {
      const tileCanvas = prepareTileForOcr(cellCanvas, rotation, inkMode);
      const glyphMask = createGlyphMask(tileCanvas);
      if (!glyphMask.pixels) continue;

      for (const template of templates) {
        const score = compareGlyphMasks(glyphMask.mask, template.mask);
        if (!best || score > best.score) {
          secondScore = best?.score || 0;
          best = {
            text: template.label,
            letter: template.label === "QU" ? "Q" : template.label,
            rotation,
            score,
            source,
            inkMode
          };
        } else if (score > secondScore) {
          secondScore = score;
        }
      }
    }
  }

  if (!best) {
    return { text: "", letter: "", confidence: 0, rotation: 0, score: 0, source: "template" };
  }

  const margin = Math.max(0, best.score - secondScore);
  const confidentMatch = best.score >= 0.84 && margin >= 0.015;
  const confidence = confidentMatch
    ? 99
    : Math.max(0, Math.min(96, Math.round(best.score * 82 + margin * 360)));
  return { ...best, confidence, margin };
}

function getTemplateMasks() {
  if (templateMasks) return templateMasks;

  templateMasks = getPhotoTemplateMasks();
  for (const label of OCR_TEMPLATE_LABELS) {
    for (const fontFamily of OCR_TEMPLATE_FONTS) {
      for (const weight of [700]) {
        const canvas = document.createElement("canvas");
        canvas.width = OCR_CANVAS_SIZE;
        canvas.height = OCR_CANVAS_SIZE;
        const context = canvas.getContext("2d");
        context.fillStyle = "#fff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = "#000";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.font = `${weight} ${label === "QU" ? 70 : 104}px ${fontFamily}`;
        context.fillText(label === "QU" ? "Qu" : label, canvas.width / 2, canvas.height / 2 + 4);

        const glyphMask = createGlyphMask(canvas);
        if (glyphMask.pixels) {
          templateMasks.push({ label, mask: glyphMask.mask });
        }
      }
    }
  }

  return templateMasks;
}

function getPhotoTemplateMasks() {
  if (decodedPhotoTemplateMasks) return decodedPhotoTemplateMasks;

  decodedPhotoTemplateMasks = PHOTO_DICE_TEMPLATE_MASKS.map((template) => ({
    label: template.label,
    mask: unpackTemplateMask(template.data),
    source: "photo-template"
  }));

  return decodedPhotoTemplateMasks.slice();
}

function unpackTemplateMask(data) {
  const binary = atob(data);
  const mask = new Uint8Array(OCR_MASK_SIZE * OCR_MASK_SIZE);

  for (let index = 0; index < binary.length; index += 1) {
    const byte = binary.charCodeAt(index);
    for (let bit = 0; bit < 8; bit += 1) {
      const maskIndex = index * 8 + bit;
      if (maskIndex >= mask.length) break;
      mask[maskIndex] = (byte >> (7 - bit)) & 1;
    }
  }

  return mask;
}

function createGlyphMask(canvas) {
  const context = canvas.getContext("2d");
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const grays = [];
  const sourceMask = new Uint8Array(canvas.width * canvas.height);

  for (let index = 0; index < imageData.data.length; index += 4) {
    const red = imageData.data[index];
    const green = imageData.data[index + 1];
    const blue = imageData.data[index + 2];
    grays.push(red * 0.299 + green * 0.587 + blue * 0.114);
  }

  const threshold = getOtsuThreshold(grays);
  let minX = canvas.width;
  let minY = canvas.height;
  let maxX = -1;
  let maxY = -1;
  let pixels = 0;
  const edge = Math.round(canvas.width * 0.05);

  for (let y = edge; y < canvas.height - edge; y += 1) {
    for (let x = edge; x < canvas.width - edge; x += 1) {
      const index = y * canvas.width + x;
      if (grays[index] >= threshold) continue;
      sourceMask[index] = 1;
      pixels += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (!pixels || maxX < minX || maxY < minY) {
    return { mask: new Uint8Array(OCR_MASK_SIZE * OCR_MASK_SIZE), pixels: 0 };
  }

  const glyphWidth = maxX - minX + 1;
  const glyphHeight = maxY - minY + 1;
  const scale = Math.min((OCR_MASK_SIZE - 12) / glyphWidth, (OCR_MASK_SIZE - 12) / glyphHeight);
  const drawWidth = glyphWidth * scale;
  const drawHeight = glyphHeight * scale;
  const offsetX = (OCR_MASK_SIZE - drawWidth) / 2;
  const offsetY = (OCR_MASK_SIZE - drawHeight) / 2;
  const normalizedMask = new Uint8Array(OCR_MASK_SIZE * OCR_MASK_SIZE);

  for (let y = 0; y < OCR_MASK_SIZE; y += 1) {
    for (let x = 0; x < OCR_MASK_SIZE; x += 1) {
      const sourceX = Math.floor(minX + (x - offsetX) / scale);
      const sourceY = Math.floor(minY + (y - offsetY) / scale);
      if (
        sourceX >= minX &&
        sourceX <= maxX &&
        sourceY >= minY &&
        sourceY <= maxY &&
        sourceMask[sourceY * canvas.width + sourceX]
      ) {
        normalizedMask[y * OCR_MASK_SIZE + x] = 1;
      }
    }
  }

  const mask = dilateMask(normalizedMask, OCR_MASK_SIZE);
  return { mask, pixels: countMaskPixels(mask) };
}

function compareGlyphMasks(candidateMask, templateMask) {
  let intersection = 0;
  let union = 0;
  let templatePixels = 0;

  for (let index = 0; index < candidateMask.length; index += 1) {
    const candidate = candidateMask[index];
    const template = templateMask[index];
    if (template) templatePixels += 1;
    if (candidate || template) union += 1;
    if (candidate && template) intersection += 1;
  }

  if (!union || !templatePixels) return 0;
  const jaccard = intersection / union;
  const coverage = intersection / templatePixels;
  return jaccard * 0.7 + coverage * 0.3;
}

function dilateMask(mask, size) {
  const output = new Uint8Array(mask.length);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = y * size + x;
      if (!mask[index]) continue;

      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < size && ny >= 0 && ny < size) {
            output[ny * size + nx] = 1;
          }
        }
      }
    }
  }
  return output;
}

function countMaskPixels(mask) {
  return mask.reduce((sum, value) => sum + value, 0);
}

function getOtsuThreshold(values) {
  const histogram = new Array(256).fill(0);
  for (const value of values) {
    histogram[Math.max(0, Math.min(255, Math.round(value)))] += 1;
  }

  const total = values.length;
  let sum = 0;
  for (let index = 0; index < 256; index += 1) {
    sum += index * histogram[index];
  }

  let sumBackground = 0;
  let weightBackground = 0;
  let maxVariance = -1;
  let threshold = 128;

  for (let index = 0; index < 256; index += 1) {
    weightBackground += histogram[index];
    if (!weightBackground) continue;

    const weightForeground = total - weightBackground;
    if (!weightForeground) break;

    sumBackground += index * histogram[index];
    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (sum - sumBackground) / weightForeground;
    const variance = weightBackground * weightForeground * (meanBackground - meanForeground) ** 2;

    if (variance > maxVariance) {
      maxVariance = variance;
      threshold = index;
    }
  }

  return Math.max(45, Math.min(210, threshold));
}

function renderOcrReview(results) {
  elements.ocrReviewGrid.style.setProperty("--board-size", getSize());
  elements.ocrReviewGrid.replaceChildren();

  const fragment = document.createDocumentFragment();
  for (const result of results) {
    const label = document.createElement("label");
    label.className = "ocr-cell";
    if (isWeakOcrCandidate(result)) {
      label.classList.add("is-weak");
    }

    const number = document.createElement("span");
    number.textContent = result.index + 1;

    const input = document.createElement("input");
    input.value = result.letter === "Q" ? "Qu" : result.letter;
    input.maxLength = 2;
    input.inputMode = "text";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.dataset.index = String(result.index);
    input.setAttribute("aria-label", `Scanned tile ${result.index + 1}`);
    input.addEventListener("input", () => {
      input.value = cleanReviewInput(input.value);
    });

    label.append(number, input);
    fragment.append(label);
  }

  elements.ocrReviewGrid.append(fragment);
  elements.ocrReviewPanel.hidden = false;
}

function getReviewResults() {
  const values = Array.from(elements.ocrReviewGrid.querySelectorAll("input"))
    .sort((left, right) => Number(left.dataset.index) - Number(right.dataset.index))
    .map((input) => cleanReviewInput(input.value));
  const letters = values.map((value) => (value.toUpperCase() === "QU" ? "Q" : value));

  return letters.map((letter, index) => ({
    ...(lastOcrResults[index] || {}),
    index,
    letter: normalizeOcrLetter(letter) || "E"
  }));
}

function applyOcrResults(results) {
  lastOcrResults = results.map((result, index) => ({
    ...result,
    index,
    letter: normalizeOcrLetter(result.letter || result.text) || "E"
  }));

  elements.boardInput.value = lettersToBoardInput(lastOcrResults.map((result) => result.letter));
  clearResults();
  renderBoard();
  if (dictionary) solveCurrentBoard();
}

function applyOcrReview() {
  applyOcrResults(getReviewResults());
  elements.ocrReviewPanel.hidden = true;
  setOcrStatus("Applied scan edits.");
}

function rotateOcrReview(direction) {
  const size = getSize();
  const rotated = rotateBoardLetters(getReviewResults(), size, direction)
    .map((result, index) => ({ ...result, index }));

  applyOcrResults(rotated);
  renderOcrReview(lastOcrResults);
  setOcrStatus(`Rotated scan ${direction === "clockwise" ? "right" : "left"}.`);
}

function cleanReviewInput(value) {
  const cleaned = String(value || "").toUpperCase().replace(/[^A-Z]/g, "");
  if (cleaned.startsWith("QU")) return "Qu";
  return cleaned.slice(0, 1);
}

function setOcrStatus(message) {
  elements.ocrStatus.textContent = message;
  elements.ocrStatus.hidden = !message;
}
