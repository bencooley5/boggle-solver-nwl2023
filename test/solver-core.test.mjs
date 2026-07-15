import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  SAMPLE_BOARD_5,
  chooseRichBoggleBoard,
  parseBoardInput,
  parseDictionaryText,
  resolveDefinition,
  scoreWord,
  solveBoard
} from "../solver-core.js";
import {
  chooseBestOcrCandidate,
  isWeakOcrCandidate,
  lettersToBoardInput,
  normalizeOcrLetter,
  rotateBoardLetters
} from "../ocr-utils.js";
import { PHOTO_DICE_TEMPLATE_MASKS } from "../ocr-photo-templates.js";
import { canBuildWord, chooseRichRack, findRackWords, groupRackWordsByLength } from "../anagram-core.js";
import { parseWiktionaryExtract } from "../dictionary-enrichment.js";

test("turns dictionary cross-references into readable definitions", () => {
  const dictionary = parseDictionaryText([
    "CANTRIP a magic spell [n CANTRIPS]",
    "CANTRAIP {cantrip=n} [n CANTRAIPS]"
  ].join("\n"), { minLength: 2 });

  const definition = resolveDefinition("CANTRAIP", dictionary.wordDefinitions);
  assert.match(definition, /Alternative form of CANTRIP/);
  assert.match(definition, /a magic spell/);
  assert.doesNotMatch(definition, /\{cantrip=n\}/);
});

test("extracts richer senses, alternate spellings, and origin information", () => {
  const extract = `== English ==

=== Alternative forms ===
cantrap, cantrup, cantraip

=== Etymology ===
From Middle Scots cantrip, cantrap (“a magic charm; a trick”). Further origin obscure.

=== Pronunciation ===
IPA(key): /ˈkæntrɪp/

=== Noun ===
cantrip (plural cantrips)

A spell or incantation; a trifling magic trick.

A wilful piece of trickery or mischief.

(roleplaying games) A minor spell.`;
  const entry = parseWiktionaryExtract("cantrip", extract);

  assert.deepEqual(entry.alternativeForms, ["cantrap", "cantrup", "cantraip"]);
  assert.match(entry.etymology, /Middle Scots/);
  assert.equal(entry.pronunciation, "/ˈkæntrɪp/");
  assert.equal(entry.senses.length, 3);
});

test("finds rack words while respecting duplicate letters and length limits", () => {
  const dictionary = parseDictionaryText([
    "ACRE a unit of land [n ACRES]",
    "ACRES <acre=n> [n]",
    "CAN an airtight container [n CANS]",
    "CANE a walking stick [n CANES]",
    "CRANE a bird [n CRANES]",
    "CRANES <crane=n> [n]",
    "RACER one that races [n RACERS]"
  ].join("\n"), { minLength: 2 });

  assert.equal(canBuildWord("ACRE", "CRANES"), true);
  assert.equal(canBuildWord("RACER", "CRANES"), false);
  assert.deepEqual(findRackWords("CRANES", dictionary, { minLength: 4 }).map(({ word }) => word), ["ACRE", "CANE", "ACRES", "CRANE", "CRANES"]);
  assert.equal(groupRackWordsByLength(findRackWords("CRANES", dictionary, { minLength: 4 }), 4, 6).get(5).length, 2);
});

test("chooses a full-length rack with playable sub-anagrams", () => {
  const dictionary = parseDictionaryText([
    "ACRE a unit of land [n ACRES]",
    "ACRES <acre=n> [n]",
    "CRANE a bird [n CRANES]",
    "CRANES <crane=n> [n]"
  ].join("\n"), { minLength: 2 });
  const round = chooseRichRack(dictionary, { letterCount: 6, minLength: 4, sampleSize: 20, rng: () => 0 });

  assert.equal(round.sortedRack, "ACENRS");
  assert.ok(round.words.some(({ word }) => word === "CRANES"));
});

test("chooses a playable Boggle practice board and keeps word paths", () => {
  const dictionary = parseDictionaryText([
    "AT in the position of [prep]",
    "CAT a feline animal [n CATS]",
    "CATS <cat=n> [n]",
    "SAT <sit=v> [v]"
  ].join("\n"), { minLength: 2 });
  const round = chooseRichBoggleBoard(dictionary, {
    size: 2,
    minLength: 3,
    sampleSize: 1,
    createBoard: () => ["C", "A", "T", "S"]
  });

  assert.equal(round.boardKey, "CATS");
  assert.deepEqual(round.words.map(({ word }) => word).sort(), ["CAT", "CATS", "SAT"]);
  assert.ok(round.words.every(({ path }) => path.length >= 3));
  assert.equal(round.totalPoints, 3);
});

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
  assert.equal(isWeakOcrCandidate({ letter: "A", confidence: 40 }), true);
  assert.equal(isWeakOcrCandidate({ letter: "A", confidence: 88 }), false);
});

test("rotates OCR review letters to fix sideways board photos", () => {
  const photoRows = "AOPACNMSCHIAEQDTETEOLTCNY";
  const expectedRows = "LTINATEAMOCTESPNEQCAYODHC";

  assert.equal(rotateBoardLetters(Array.from(photoRows), 5, "clockwise").join(""), expectedRows);
  assert.equal(rotateBoardLetters(Array.from(expectedRows), 5, "counterclockwise").join(""), photoRows);
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

test("OCR photo fixtures include all four uploaded boards with exact tile labels", () => {
  const fixtureBoards = [];
  for (let index = 0; index < PHOTO_DICE_TEMPLATE_MASKS.length; index += 25) {
    fixtureBoards.push(PHOTO_DICE_TEMPLATE_MASKS.slice(index, index + 25).map(({ label }) => label).join(""));
  }

  assert.ok(fixtureBoards.includes("ANIPENRNAEOIATIEBTHSFOSOL"), "IMG_7267 should match exactly");
  assert.ok(fixtureBoards.includes("HOARSCHARTAEELAITINLFNMAH"), "IMG_7268 should match exactly");
  assert.ok(fixtureBoards.includes("NEHRYECEOEUACOIMMEXIITGAH"), "IMG_7269 should match exactly");
  assert.ok(fixtureBoards.includes("MRVYYNTCHISSTENEGTDEEOTNH"), "IMG_7271 should match exactly");
});

test("OCR build badge is in the top hero and the old version box is removed", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");

  assert.match(html, /class="build-line"[^>]*>[^<]*powered by the[\s\S]*id="ocr-build"/);
  assert.doesNotMatch(html, /class="build-row"/);
  assert.match(app, /finally \{\s*clearOcrLog\(\);/);
  assert.match(app, /guessBoardWithPhotoTemplates\(dieCells, size\)/);
  assert.match(app, /source: "board-photo-consensus"/);
});
