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

const QUESTION_INTENT_PATTERNS: Array<{
  intent:
    | "authorization"
    | "sponsorship"
    | "relocation"
    | "experience"
    | "motivation"
    | "compensation"
    | "portfolio"
    | "location"
    | "notice";
  tokens: string[];
}> = [
  {
    intent: "authorization",
    tokens: [
      "authorized to work",
      "legally authorized",
      "eligible to work",
      "work authorization",
    ],
  },
  {
    intent: "sponsorship",
    tokens: [
      "sponsorship",
      "visa",
      "require sponsorship",
      "need sponsorship",
    ],
  },
  {
    intent: "relocation",
    tokens: ["relocate", "relocation", "move for this role"],
  },
  {
    intent: "experience",
    tokens: ["years of experience", "years experience", "experience with"],
  },
  {
    intent: "motivation",
    tokens: [
      "why do you want",
      "why are you interested",
      "why this role",
      "why this company",
      "tell us why",
      "motivation",
    ],
  },
  {
    intent: "compensation",
    tokens: [
      "salary",
      "compensation",
      "pay expectation",
      "expected pay",
      "expected salary",
    ],
  },
  {
    intent: "portfolio",
    tokens: ["portfolio", "website", "github", "linkedin"],
  },
  {
    intent: "location",
    tokens: ["city", "state", "country", "location"],
  },
  {
    intent: "notice",
    tokens: ["notice period", "start date", "available to start"],
  },
];

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
  const lookupTokens = buildLookupTokenSet(question, descriptor);
  const lookupIntents = detectQuestionIntents(question, descriptor);
  if (lookupKeys.length === 0) {
    return null;
  }

  let best: { answer: SavedAnswer; score: number } | null = null;

  for (const [key, answer] of Object.entries(answers)) {
    const candidateKeys = buildAnswerLookupKeys(answer.question || key, key);
    const candidateTokens = buildLookupTokenSet(answer.question || key, key);
    const candidateIntents = detectQuestionIntents(answer.question || key, key);
    if (candidateKeys.length === 0) {
      continue;
    }
    if (!hasCompatibleQuestionIntents(lookupIntents, candidateIntents)) {
      continue;
    }
    const sharesIntent =
      lookupIntents.size > 0 &&
      candidateIntents.size > 0 &&
      hasCompatibleQuestionIntents(lookupIntents, candidateIntents);

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

    const overlap = calculateTokenOverlap(lookupTokens, candidateTokens);
    if (overlap === 0 && !sharesIntent && score < 0.92) {
      continue;
    }

    score = Math.max(score, overlap * 0.9);
    if (sharesIntent) {
      score = Math.max(score, 0.78);
    }
    if (overlap > 0) {
      score = Math.max(score, score * 0.8 + overlap * 0.2);
    }
    if (lookupIntents.size > 0 && candidateIntents.size > 0) {
      score = Math.min(1, score + 0.05);
    }

    if (!best || score > best.score) {
      best = { answer, score };
    }
  }

  return best && best.score >= 0.78 ? best.answer : null;
}

export function getRelevantSavedAnswers(
  question: string,
  answers: Record<string, SavedAnswer>
): SavedAnswer[] {
  const lookupTokens = buildLookupTokenSet(question);
  const lookupIntents = detectQuestionIntents(question);

  return Object.values(answers)
    .filter((answer) => {
      const candidateTokens = buildLookupTokenSet(answer.question);
      const candidateIntents = detectQuestionIntents(answer.question);

      if (!hasCompatibleQuestionIntents(lookupIntents, candidateIntents)) {
        return false;
      }

      return (
        textSimilarity(question, answer.question) >= 0.78 ||
        calculateTokenOverlap(lookupTokens, candidateTokens) >= 0.5 ||
        (lookupIntents.size > 0 && candidateIntents.size > 0)
      );
    })
    .sort((left, right) => right.updatedAt - left.updatedAt);
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

function buildLookupTokenSet(...values: string[]): Set<string> {
  const tokens = new Set<string>();

  for (const value of values) {
    for (const token of normalizeQuestionKey(value).split(" ")) {
      const cleaned = token.trim();
      if (!cleaned || QUESTION_STOP_WORDS.has(cleaned) || cleaned.length < 2) {
        continue;
      }
      tokens.add(cleaned);
    }
  }

  return tokens;
}

function detectQuestionIntents(...values: string[]): Set<string> {
  const normalized = values
    .map((value) => normalizeQuestionKey(value))
    .filter(Boolean)
    .join(" ");
  const intents = new Set<string>();

  for (const { intent, tokens } of QUESTION_INTENT_PATTERNS) {
    if (tokens.some((token) => normalized.includes(normalizeQuestionKey(token)))) {
      intents.add(intent);
    }
  }

  return intents;
}

function hasCompatibleQuestionIntents(
  lookupIntents: Set<string>,
  candidateIntents: Set<string>
): boolean {
  if (lookupIntents.size === 0 || candidateIntents.size === 0) {
    return true;
  }

  for (const intent of lookupIntents) {
    if (candidateIntents.has(intent)) {
      return true;
    }
  }

  return false;
}

function calculateTokenOverlap(
  left: Set<string>,
  right: Set<string>
): number {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  let matches = 0;
  for (const token of left) {
    if (right.has(token)) {
      matches += 1;
    }
  }

  return matches / Math.max(Math.min(left.size, right.size), 1);
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
