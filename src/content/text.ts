// Text normalization and extraction helpers used across the content runtime.

export function cleanText(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  return value
    .replace(/\s+/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim();
}

const READABLE_TEXT_BREAK_TAGS = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "BR",
  "DD",
  "DIV",
  "DL",
  "DT",
  "FIELDSET",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "FORM",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "HR",
  "LI",
  "MAIN",
  "NAV",
  "OL",
  "P",
  "SECTION",
  "TABLE",
  "TBODY",
  "TD",
  "TFOOT",
  "TH",
  "THEAD",
  "TR",
  "UL",
]);

export function getReadableText(node: Node | null | undefined): string {
  if (!node) {
    return "";
  }

  const chunks: string[] = [];
  const pushChunk = (chunk: string | null | undefined) => {
    if (chunk) {
      chunks.push(chunk);
    }
  };

  const walk = (current: Node): void => {
    if (current.nodeType === Node.TEXT_NODE) {
      pushChunk(current.textContent);
      return;
    }

    if (current.nodeType !== Node.ELEMENT_NODE) {
      return;
    }

    const element = current as Element;
    const isBreakTag = READABLE_TEXT_BREAK_TAGS.has(element.tagName.toUpperCase());

    if (isBreakTag && chunks.length > 0) {
      pushChunk(" ");
    }

    for (const child of Array.from(element.childNodes)) {
      walk(child);
    }

    if (isBreakTag) {
      pushChunk(" ");
    }
  };

  walk(node);
  return cleanText(chunks.join(" "));
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

  return value.replace(/["'\\#.:[\]()>+~=^$*|]/g, "\\$&");
}

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

