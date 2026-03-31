import {
  SavedAnswer,
  isUsefulSavedAnswer,
  normalizeQuestionKey,
} from "../shared";
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
    | "linkedin"
    | "github"
    | "city"
    | "state"
    | "country"
    | "location"
    | "notice_period"
    | "start_date"
    | "website"
    | "phone"
    | "email";
  tokens: string[];
}> = [
  {
    intent: "authorization",
    tokens: [
      "authorized to work",
      "legally authorized",
      "eligible to work",
      "work authorization",
      "work permit",
      "employment authorization",
    ],
  },
  {
    intent: "sponsorship",
    tokens: [
      "sponsorship",
      "visa",
      "require sponsorship",
      "need sponsorship",
      "h1b",
      "work visa",
    ],
  },
  {
    intent: "relocation",
    tokens: ["relocate", "relocation", "move for this role", "willing to relocate"],
  },
  {
    intent: "experience",
    tokens: ["years of experience", "years experience", "experience with", "how many years"],
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
      "interest in",
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
      "salary expectation",
      "pay rate",
      "hourly rate",
    ],
  },
  {
    intent: "portfolio",
    tokens: ["portfolio", "personal site", "website", "work samples"],
  },
  {
    intent: "linkedin",
    tokens: ["linkedin", "linkedin profile", "linkedin url"],
  },
  {
    intent: "github",
    tokens: ["github", "github profile", "github url", "gitlab", "bitbucket"],
  },
  {
    intent: "city",
    tokens: ["city", "current city", "home city"],
  },
  {
    intent: "state",
    tokens: ["state", "province", "region", "territory"],
  },
  {
    intent: "country",
    tokens: ["country", "nation"],
  },
  {
    intent: "location",
    tokens: ["location", "address", "where do you live", "residence"],
  },
  {
    intent: "notice_period",
    tokens: ["notice period", "notice time", "available after"],
  },
  {
    intent: "start_date",
    tokens: ["start date", "available to start", "can you start", "earliest start", "start immediately"],
  },
  {
    intent: "website",
    tokens: ["website", "web site", "portfolio site", "personal website"],
  },
  {
    intent: "phone",
    tokens: ["phone", "telephone", "mobile", "cell phone", "contact number"],
  },
  {
    intent: "email",
    tokens: ["email", "e-mail", "email address"],
  },
];

const EXPERIENCE_SUBJECT_STOP_WORDS = new Set([
  "background",
  "experience",
  "experienced",
  "expertise",
  "familiar",
  "familiarity",
  "have",
  "how",
  "in",
  "many",
  "much",
  "of",
  "overall",
  "professional",
  "relevant",
  "skill",
  "skills",
  "total",
  "using",
  "with",
  "work",
  "working",
  "year",
  "years",
]);

type QuestionMatchContext = {
  keys: string[];
  tokens: Set<string>;
  intents: Set<string>;
  experienceSubjects: Set<string>;
  experienceLike: boolean;
};

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

  if (!isUsefulSavedAnswer(cleanedQuestion, cleanedValue)) {
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
  const lookup = buildQuestionMatchContext(question, descriptor);
  if (lookup.keys.length === 0) {
    return null;
  }

  let best: { answer: SavedAnswer; score: number } | null = null;

  for (const [key, answer] of Object.entries(answers)) {
    const candidate = buildQuestionMatchContext(answer.question || key, key);
    if (candidate.keys.length === 0) {
      continue;
    }
    if (!isCompatibleQuestionMatchContext(lookup, candidate)) {
      continue;
    }
    const sharesIntent =
      lookup.intents.size > 0 &&
      candidate.intents.size > 0 &&
      hasCompatibleQuestionIntents(lookup.intents, candidate.intents);

    // Check for exact question match first (highest priority)
    const exactMatch = lookup.keys.some(lk => 
      candidate.keys.some(ck => lk === ck)
    );
    
    let score = exactMatch ? 1.0 : 0;

    // Calculate similarity scores
    for (const lookupKey of lookup.keys) {
      for (const candidateKey of candidate.keys) {
        if (lookupKey === candidateKey) {
          score = Math.max(score, 1);
          continue;
        }

        // Substring match (high confidence)
        if (
          lookupKey.includes(candidateKey) ||
          candidateKey.includes(lookupKey)
        ) {
          score = Math.max(score, 0.92);
        }

        // Fuzzy text similarity
        const similarity = textSimilarity(lookupKey, candidateKey);
        if (similarity > 0.85) {
          score = Math.max(score, similarity);
        }
      }
    }

    const overlap = calculateTokenOverlap(lookup.tokens, candidate.tokens);
    
    // Skip if no signal at all
    if (overlap === 0 && !sharesIntent && score < 0.92 && !exactMatch) {
      continue;
    }

    // Boost score based on token overlap
    if (overlap > 0) {
      score = Math.max(score, overlap * 0.9);
      score = Math.max(score, score * 0.8 + overlap * 0.2);
    }
    
    // Boost for shared intent
    if (sharesIntent) {
      score = Math.max(score, 0.78);
      score = Math.min(1, score + 0.05);
    }
    
    // Boost for recent answers (prefer fresher data)
    const recencyBoost = Math.min(0.05, (Date.now() - answer.updatedAt) / (30 * 24 * 60 * 60 * 1000) * 0.05);
    score = Math.min(1, score + recencyBoost);

    if (!best || score > best.score) {
      best = { answer, score };
    }
  }

  return best && best.score >= 0.78 ? best.answer : null;
}

function buildQuestionMatchContext(
  question: string,
  descriptor = ""
): QuestionMatchContext {
  const tokens = buildLookupTokenSet(question, descriptor);
  const intents = detectQuestionIntents(question, descriptor);

  return {
    keys: buildAnswerLookupKeys(question, descriptor),
    tokens,
    intents,
    experienceSubjects: extractExperienceSubjects(tokens),
    experienceLike: isExperienceLikeQuestion(tokens),
  };
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

function isCompatibleQuestionMatchContext(
  lookup: QuestionMatchContext,
  candidate: QuestionMatchContext
): boolean {
  if (!hasCompatibleQuestionIntents(lookup.intents, candidate.intents)) {
    return false;
  }

  if (
    lookup.experienceLike &&
    candidate.experienceLike &&
    lookup.experienceSubjects.size > 0 &&
    candidate.experienceSubjects.size > 0 &&
    !setsIntersect(lookup.experienceSubjects, candidate.experienceSubjects)
  ) {
    return false;
  }

  return true;
}

function extractExperienceSubjects(tokens: Set<string>): Set<string> {
  const subjects = new Set<string>();

  for (const token of tokens) {
    if (!EXPERIENCE_SUBJECT_STOP_WORDS.has(token)) {
      subjects.add(token);
    }
  }

  return subjects;
}

function isExperienceLikeQuestion(tokens: Set<string>): boolean {
  return tokens.has("experience") || tokens.has("year") || tokens.has("years");
}

function setsIntersect(left: Set<string>, right: Set<string>): boolean {
  for (const value of left) {
    if (right.has(value)) {
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
