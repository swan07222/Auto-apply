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

