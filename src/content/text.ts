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

export function truncateText(value: string, maxLength: number): string {
  const text = cleanText(value);
  const safeLength = Math.max(0, Math.floor(maxLength));

  if (!text || safeLength <= 0 || text.length <= safeLength) {
    return text;
  }

  if (safeLength <= 3) {
    return ".".repeat(Math.max(0, safeLength));
  }

  const visibleLength = safeLength - 3;
  const truncated = text.slice(0, visibleLength).trimEnd();
  const boundary = truncated.lastIndexOf(" ");
  const preferred =
    boundary >= visibleLength - 2 ? truncated.slice(0, boundary) : truncated;

  return `${preferred.trimEnd()}...`;
}

export function extractNumber(value: string): number | null {
  const match = cleanText(value).match(/-?\d[\d,]*(?:\.\d+)?/);
  if (!match) {
    return null;
  }

  const numeric = Number.parseFloat(match[0].replace(/,/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

export function extractEmail(value: string): string | null {
  return (
    cleanText(value).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ??
    null
  );
}

export function extractPhone(value: string): string | null {
  const match = cleanText(value).match(
    /(?:\+\d{1,2}\s*)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}/
  );
  return match?.[0] ?? null;
}

export function extractUrl(value: string): string | null {
  return cleanText(value).match(/https?:\/\/[^\s"'<>]+/i)?.[0] ?? null;
}

