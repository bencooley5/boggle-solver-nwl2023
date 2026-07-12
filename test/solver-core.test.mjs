import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  SAMPLE_BOARD_5,
  parseBoardInput,
  parseDictionaryText,
  resolveDefinition,
  scoreWord,
  solveBoard
} from "../solver-core.js";
import {
  chooseBestOcrCandidate,
  lettersToBoardInput,
  normalizeOcrLetter
} from "../ocr-utils.js";

test("parses Q as a Qu tile and accepts explicit Qu input", () => {
  assert.deepEqual(parseBoardInput("QABCDEFGHIJKLMNO", 4).tiles[0], "QU");
  assert.equal(parseBoardInput("QuABCDEFGHIJKLMNO", 4).tiles.length, 16);
});

test("scores words with standard Boggle scoring", () => {
  assert.equal(scoreWord("CAT"), 1);
  assert.equal(scoreWord("TREES"), 2);
  assert.equal(scoreWord("QUOTAS"), 3);
  assert.equal(scoreWord("GESTATE"), 5);
  assert.equal(scoreWord("SERGEANT"), 11);
});

test("resolves inflection references to base definitions", () => {
  const dictionary = parseDictionaryText([
    "AA rough, cindery lava [n AAS]",
    "AAS <aa=n> [n]",
    "GESTATE to carry in the uterus during pregnancy [v GESTATED, GESTATES, GESTATING]",
    "GESTATES <gestate=v> [v]"
  ].join("\n"));

  assert.equal(dictionary.playableEntries, 3);
  assert.match(resolveDefinition("AAS", dictionary.wordDefinitions), /rough, cindery lava/);
  assert.match(resolveDefinition("GESTATES", dictionary.wordDefinitions), /GESTATE: to carry/);
});

test("solves a small board through the trie", () => {
  const dictionary = parseDictionaryText([
    "CAST to throw [v CAST, CASTING, CASTS]",
    "TOO also [adv]",
    "TOOL an implement [n TOOLS]"
  ].join("\n"));
  const parsed = parseBoardInput("CASTXLOOABCDEFGH", 4);
  const words = solveBoard(parsed.tiles, 4, dictionary).map((result) => result.word).sort();

  assert.deepEqual(words, ["CAST", "TOO", "TOOL"]);
});

test("filters solved words with a custom minimum length", () => {
  const dictionary = parseDictionaryText([
    "AT to respond online [v ATS]",
    "ATE consumed food [v]",
    "EAT to consume food [v ATE, EATEN, EATING, EATS]",
    "TEA a drink [n TEAS]",
    "TEAS <tea=n> [n]"
  ].join("\n"), { minLength: 2 });
  const parsed = parseBoardInput("ATBCEFGHIJKLMNOP", 4);

  const twoPlus = solveBoard(parsed.tiles, 4, dictionary, { minLength: 2 }).map((result) => result.word).sort();
  const threePlus = solveBoard(parsed.tiles, 4, dictionary, { minLength: 3 }).map((result) => result.word).sort();

  assert.deepEqual(twoPlus, ["AT", "ATE", "EAT", "TEA"]);
  assert.deepEqual(threePlus, ["ATE", "EAT", "TEA"]);
});

test("normalizes OCR letters and chooses the best rotated candidate", () => {
  assert.equal(normalizeOcrLetter("qu"), "Q");
  assert.equal(normalizeOcrLetter("0"), "O");
  assert.equal(normalizeOcrLetter("$"), "S");
  assert.equal(lettersToBoardInput(["A", "QU", "0", ""]), "AQOE");

  const best = chooseBestOcrCandidate([
    { text: "", confidence: 92, rotation: 0 },
    { text: "1", confidence: 45, rotation: 90 },
    { text: "I", confidence: 88, rotation: 180 }
  ]);

  assert.equal(best.letter, "I");
  assert.equal(best.rotation, 180);
});

test("local NWL2023 data includes definitions and solves the sample board", async () => {
  const text = await readFile(new URL("../data/nwl2023.txt", import.meta.url), "utf8");
  const dictionary = parseDictionaryText(text);
  const parsed = parseBoardInput(SAMPLE_BOARD_5, 5);
  const results = solveBoard(parsed.tiles, 5, dictionary);
  const gestate = results.find((result) => result.word === "GESTATE");

  assert.equal(dictionary.totalEntries, 196601);
  assert.ok(gestate);
  assert.match(gestate.definition, /carry in the uterus/);
});
