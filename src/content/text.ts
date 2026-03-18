// src/content/text.ts
// COMPLETE FILE — replace entirely

export function cleanText(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  return value
    .replace(/\s+/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "") // FIX: Remove zero-width characters
    .trim();
}

export function truncateText(value: string, max: number): string {
  if (!value) {
    return "";
  }

  if (value.length <= max) {
    return value;
  }

  // FIX: Try to truncate at word boundary
  const truncated = value.slice(0, max - 3);
  const lastSpace = truncated.lastIndexOf(" ");

  if (lastSpace > max * 0.7) {
    return `${truncated.slice(0, lastSpace).trim()}...`;
  }

  return `${truncated.trim()}...`;
}

export function normalizeChoiceText(value: string): string {
  if (!value) {
    return "";
  }

  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function cssEscape(value: string): string {
  if (!value) {
    return "";
  }

  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }

  // FIX: More comprehensive fallback escape
  return value.replace(/["'\\#.:[\]()>+~=^$*|]/g, "\\$&");
}

// FIX: Add helper to extract numbers from text
export function extractNumber(value: string): number | null {
  if (!value) {
    return null;
  }

  const match = value.match(/[\d,]+\.?\d*/);
  if (!match) {
    return null;
  }

  const num = parseFloat(match[0].replace(/,/g, ""));
  return Number.isFinite(num) ? num : null;
}

// FIX: Add helper to compare text similarity
export function textSimilarity(a: string, b: string): number {
  if (!a || !b) {
    return 0;
  }

  const normalA = normalizeChoiceText(a);
  const normalB = normalizeChoiceText(b);

  if (normalA === normalB) {
    return 1;
  }

  if (normalA.includes(normalB) || normalB.includes(normalA)) {
    return 0.8;
  }

  // Simple word overlap calculation
  const wordsA = new Set(normalA.split(" ").filter(Boolean));
  const wordsB = new Set(normalB.split(" ").filter(Boolean));

  if (wordsA.size === 0 || wordsB.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) {
      overlap++;
    }
  }

  return overlap / Math.max(wordsA.size, wordsB.size);
}

// FIX: Add helper to check if text looks like a question
export function looksLikeQuestion(text: string): boolean {
  if (!text) {
    return false;
  }

  const normalized = cleanText(text).toLowerCase();

  // Ends with question mark
  if (normalized.endsWith("?")) {
    return true;
  }

  // Starts with question words
  const questionStarters = [
    "what",
    "why",
    "how",
    "when",
    "where",
    "which",
    "who",
    "whom",
    "whose",
    "do you",
    "are you",
    "have you",
    "will you",
    "would you",
    "can you",
    "could you",
    "is your",
    "please describe",
    "please explain",
    "please provide",
    "tell us",
    "describe",
    "explain",
  ];

  return questionStarters.some((starter) => normalized.startsWith(starter));
}

// FIX: Add helper to extract email from text
export function extractEmail(text: string): string | null {
  if (!text) {
    return null;
  }

  const match = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return match ? match[0] : null;
}

// FIX: Add helper to extract phone from text
export function extractPhone(text: string): string | null {
  if (!text) {
    return null;
  }

  // Match various phone formats
  const match = text.match(
    /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}/
  );
  return match ? match[0] : null;
}

// FIX: Add helper to extract URL from text
export function extractUrl(text: string): string | null {
  if (!text) {
    return null;
  }

  const match = text.match(
    /https?:\/\/[^\s<>"{}|\\^`[\]]+/i
  );
  return match ? match[0] : null;
}