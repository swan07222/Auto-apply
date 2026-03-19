import { SavedAnswer, normalizeQuestionKey } from "../shared";
import { cleanText, normalizeChoiceText, textSimilarity } from "./text";

const QUESTION_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "be",
  "can",
  "could",
  "describe",
  "did",
  "do",
  "does",
  "enter",
  "for",
  "have",
  "how",
  "i",
  "if",
  "in",
  "is",
  "many",
  "of",
  "on",
  "or",
  "please",
  "provide",
  "select",
  "tell",
  "that",
  "the",
  "this",
  "to",
  "us",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "will",
  "with",
  "would",
  "you",
  "your",
]);

export function createRememberedAnswer(
  question: string,
  value: string,
  now = Date.now()
): { key: string; answer: SavedAnswer } | null {
  const cleanedQuestion = cleanText(question);
  const cleanedValue = cleanText(value);
  const key = normalizeQuestionKey(cleanedQuestion);

  if (!cleanedQuestion || !cleanedValue || !key) {
    return null;
  }

  return {
    key,
    answer: {
      question: cleanedQuestion,
      value: cleanedValue,
      updatedAt: now,
    },
  };
}

export function findBestSavedAnswerMatch(
  question: string,
  descriptor: string,
  answers: Record<string, SavedAnswer>
): SavedAnswer | null {
  const lookupKeys = buildAnswerLookupKeys(question, descriptor);
  if (lookupKeys.length === 0) {
    return null;
  }

  let best: { answer: SavedAnswer; score: number } | null = null;

  for (const [key, answer] of Object.entries(answers)) {
    const candidateKeys = buildAnswerLookupKeys(answer.question || key, key);
    if (candidateKeys.length === 0) {
      continue;
    }

    let score = 0;

    for (const lookupKey of lookupKeys) {
      for (const candidateKey of candidateKeys) {
        if (lookupKey === candidateKey) {
          score = Math.max(score, 1);
          continue;
        }

        if (
          lookupKey.includes(candidateKey) ||
          candidateKey.includes(lookupKey)
        ) {
          score = Math.max(score, 0.92);
        }

        score = Math.max(score, textSimilarity(lookupKey, candidateKey));
      }
    }

    if (!best || score > best.score) {
      best = { answer, score };
    }
  }

  return best && best.score >= 0.68 ? best.answer : null;
}

export function getRelevantSavedAnswers(
  question: string,
  answers: Record<string, SavedAnswer>
): SavedAnswer[] {
  const lookupKeys = buildAnswerLookupKeys(question);
  if (lookupKeys.length === 0) {
    return [];
  }

  return Object.values(answers)
    .map((answer) => {
      const candidateKeys = buildAnswerLookupKeys(answer.question);
      let score = 0;

      for (const lookupKey of lookupKeys) {
        for (const candidateKey of candidateKeys) {
          if (lookupKey === candidateKey) {
            score = Math.max(score, 1);
            continue;
          }

          if (
            lookupKey.includes(candidateKey) ||
            candidateKey.includes(lookupKey)
          ) {
            score = Math.max(score, 0.9);
          }

          score = Math.max(score, textSimilarity(lookupKey, candidateKey));
        }
      }

      return { answer, score };
    })
    .filter((entry) => entry.score >= 0.4)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.answer.updatedAt - a.answer.updatedAt
    )
    .map((entry) => entry.answer)
    .slice(0, 5);
}

function buildAnswerLookupKeys(
  question: string,
  descriptor = ""
): string[] {
  const keys = new Set<string>();

  addLookupKey(keys, normalizeQuestionKey(question));
  addLookupKey(keys, normalizeQuestionKey(descriptor));
  addLookupKey(keys, buildQuestionSignature(question));
  addLookupKey(keys, buildQuestionSignature(descriptor));

  return Array.from(keys);
}

function addLookupKey(keys: Set<string>, value: string): void {
  const normalized = cleanText(value);
  if (normalized) {
    keys.add(normalized);
  }
}

function buildQuestionSignature(text: string): string {
  const normalized = normalizeChoiceText(text);
  if (!normalized) {
    return "";
  }

  const tokens = normalized
    .split(" ")
    .filter(
      (token, index, allTokens) =>
        token.length > 1 &&
        !QUESTION_STOP_WORDS.has(token) &&
        allTokens.indexOf(token) === index
    );

  return tokens.join(" ");
}
