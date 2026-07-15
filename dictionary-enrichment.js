const API_URL = "https://en.wiktionary.org/w/api.php";
const CACHE_PREFIX = "boggle-rich-dictionary-v1:";
const CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const memoryCache = new Map();

export async function fetchRichDictionaryEntry(word, options = {}) {
  const normalizedWord = String(word || "").trim().toLowerCase();
  if (!normalizedWord) return null;
  if (memoryCache.has(normalizedWord)) return memoryCache.get(normalizedWord);

  const task = fetchAndMergeEntry(normalizedWord, options.fetchImpl || fetch);
  memoryCache.set(normalizedWord, task);
  try {
    return await task;
  } catch (error) {
    memoryCache.delete(normalizedWord);
    throw error;
  }
}

export function parseWiktionaryExtract(word, extract) {
  const english = getLanguageSection(extract, "English");
  if (!english) return null;

  const sections = splitSections(english);
  const alternativeForms = parseSimpleList(sections.get("Alternative forms"));
  const etymology = firstUsefulParagraph(sections.get("Etymology"));
  const pronunciation = findPronunciation(sections.get("Pronunciation"));
  const senses = [];

  for (const partOfSpeech of ["Noun", "Verb", "Adjective", "Adverb", "Interjection", "Preposition", "Conjunction", "Pronoun", "Proper noun"]) {
    for (const content of sections.get(partOfSpeech) || []) {
      for (const sense of parseSenses(word, content)) {
        senses.push({ partOfSpeech: partOfSpeech.toLowerCase(), definition: sense });
      }
    }
  }

  const alternateTarget = senses
    .map(({ definition }) => definition.match(/Alternative (?:form|spelling) of ([A-Za-z][A-Za-z '-]*)\.?$/i)?.[1])
    .find(Boolean);

  return {
    word,
    alternativeForms,
    alternateTarget: alternateTarget?.trim().toLowerCase() || null,
    etymology,
    pronunciation,
    senses
  };
}

async function fetchAndMergeEntry(word, fetchImpl) {
  const cached = readCache(word);
  if (cached) return cached;

  const primary = await fetchEntry(word, fetchImpl);
  if (!primary) return null;
  let merged = primary;

  if (primary.alternateTarget && primary.alternateTarget !== word) {
    const base = await fetchEntry(primary.alternateTarget, fetchImpl);
    if (base) {
      merged = {
        ...primary,
        baseWord: base.word,
        alternativeForms: Array.from(new Set([word, base.word, ...primary.alternativeForms, ...base.alternativeForms])),
        etymology: primary.etymology || base.etymology,
        pronunciation: primary.pronunciation || base.pronunciation,
        senses: base.senses.length ? base.senses : primary.senses
      };
    }
  }

  merged.sourceUrl = `https://en.wiktionary.org/wiki/${encodeURIComponent(word)}`;
  writeCache(word, merged);
  return merged;
}

async function fetchEntry(word, fetchImpl) {
  const url = new URL(API_URL);
  url.searchParams.set("action", "query");
  url.searchParams.set("prop", "extracts");
  url.searchParams.set("explaintext", "1");
  url.searchParams.set("redirects", "1");
  url.searchParams.set("titles", word);
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");

  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Dictionary lookup failed (${response.status})`);
  const payload = await response.json();
  const page = Object.values(payload.query?.pages || {})[0];
  if (!page || page.missing !== undefined || !page.extract) return null;
  return parseWiktionaryExtract(word, page.extract);
}

function getLanguageSection(extract, language) {
  const normalized = String(extract || "").replace(/\r/g, "");
  const heading = new RegExp(`^==\\s*${language}\\s*==\\s*$`, "mi");
  const match = heading.exec(normalized);
  if (!match) {
    const plainHeading = new RegExp(`^${language}\\s*$`, "mi");
    const plainMatch = plainHeading.exec(normalized);
    return plainMatch ? normalized.slice(plainMatch.index + plainMatch[0].length) : "";
  }
  const remainder = normalized.slice(match.index + match[0].length);
  const nextLanguage = remainder.search(/^==[^=].*==\s*$/m);
  return nextLanguage >= 0 ? remainder.slice(0, nextLanguage) : remainder;
}

function splitSections(text) {
  const sections = new Map();
  const headingPattern = /^===\s*([^=]+?)\s*===\s*$/gm;
  const matches = Array.from(text.matchAll(headingPattern));
  if (matches.length === 0) return splitPlainSections(text);

  for (let index = 0; index < matches.length; index += 1) {
    const title = matches[index][1].trim().replace(/\s+\d+$/, "");
    const start = matches[index].index + matches[index][0].length;
    const end = matches[index + 1]?.index ?? text.length;
    const content = text.slice(start, end).split(/^====/m)[0].trim();
    if (!sections.has(title)) sections.set(title, []);
    sections.get(title).push(content);
  }
  return sections;
}

function splitPlainSections(text) {
  const known = ["Alternative forms", "Etymology", "Pronunciation", "Noun", "Verb", "Adjective", "Adverb", "Interjection", "Preposition", "Conjunction", "Pronoun", "Proper noun"];
  const lines = text.split("\n");
  const sections = new Map();
  let title = null;
  let buffer = [];
  const save = () => {
    if (!title) return;
    if (!sections.has(title)) sections.set(title, []);
    sections.get(title).push(buffer.join("\n").trim());
  };
  for (const line of lines) {
    const candidate = line.trim().replace(/\s+\d+$/, "");
    if (known.includes(candidate)) {
      save();
      title = candidate;
      buffer = [];
    } else if (title) {
      buffer.push(line);
    }
  }
  save();
  return sections;
}

function parseSimpleList(contents = []) {
  return Array.from(new Set(contents.flatMap((content) => content.split(/[\n,]/))
    .map((item) => item.trim().replace(/^[-*]\s*/, ""))
    .filter((item) => item && item.length < 60 && !/^(see|English)$/i.test(item))));
}

function firstUsefulParagraph(contents = []) {
  for (const content of contents) {
    const paragraph = content.split(/\n\s*\n/).map((item) => item.trim()).find(Boolean);
    if (paragraph) return paragraph.replace(/\s+/g, " ");
  }
  return "";
}

function findPronunciation(contents = []) {
  const text = contents.join("\n");
  const match = text.match(/IPA(?:\(key\))?:\s*([^\n]+)/i);
  return match?.[1]?.trim() || "";
}

function parseSenses(word, content) {
  const paragraphs = content.split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean);
  const senses = [];
  for (const paragraph of paragraphs) {
    for (const rawLine of paragraph.split("\n")) {
      const line = rawLine.trim().replace(/^#\s*/, "");
      if (!line || line.length > 420) continue;
      if (line.toLowerCase().startsWith(word.toLowerCase())) continue;
      if (/^(Synonyms?|Antonyms?|Hyponyms?|Hypernyms?|Derived terms?|Related terms?|Translations?|References?):/i.test(line)) continue;
      if (/^(c\.)?\s*\d{3,4}[,–-]/i.test(line) || /^\d{3,4}\b/.test(line)) break;
      if (/^(Audio|Rhymes|Homophones?):/i.test(line)) continue;
      senses.push(line);
      if (senses.length >= 5) return senses;
    }
  }
  return senses;
}

function readCache(word) {
  try {
    const saved = JSON.parse(localStorage.getItem(`${CACHE_PREFIX}${word}`));
    if (saved && Date.now() - saved.savedAt < CACHE_MAX_AGE) return saved.entry;
  } catch {}
  return null;
}

function writeCache(word, entry) {
  try {
    localStorage.setItem(`${CACHE_PREFIX}${word}`, JSON.stringify({ savedAt: Date.now(), entry }));
  } catch {}
}
