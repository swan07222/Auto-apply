import { getActionText } from "./dom";
import { cleanText, looksLikeQuestion, normalizeChoiceText } from "./text";

const REMEMBERABLE_CHOICE_SELECTOR =
  "button, [role='radio'], [role='checkbox'], [role='option'], [aria-checked], [aria-selected], [aria-pressed]";

const BLOCKED_CHOICE_TOKENS = [
  "continue",
  "next",
  "review",
  "submit",
  "apply",
  "save",
  "cancel",
  "close",
  "back",
  "previous",
  "upload resume",
  "start my application",
  "easy apply",
];

const QUESTION_CONTAINER_SELECTOR =
  "fieldset, [role='radiogroup'], [role='group'], [role='listbox'], [role='dialog'], .field, .form-field, .question, .application-question, [class*='field'], [class*='question'], [data-testid*='question'], [data-test*='question']";

export function findRememberableChoiceTarget(
  target: EventTarget | null
): HTMLElement | null {
  if (!(target instanceof Element)) {
    return null;
  }

  const choice = target.closest<HTMLElement>(REMEMBERABLE_CHOICE_SELECTOR);
  if (!choice || choice.closest("header, nav, footer, aside")) {
    return null;
  }

  const metadata = normalizeChoiceText(
    [
      getActionText(choice),
      choice.getAttribute("aria-label"),
      choice.getAttribute("title"),
      choice.getAttribute("data-test"),
      choice.getAttribute("data-testid"),
      choice.id,
      choice.className,
    ]
      .filter(Boolean)
      .join(" ")
  );

  if (
    !metadata ||
    BLOCKED_CHOICE_TOKENS.some((token) => metadata.includes(token))
  ) {
    return null;
  }

  return choice;
}

export function readChoiceAnswerForMemory(
  choice: HTMLElement
): { question: string; value: string } | null {
  const value = cleanText(getActionText(choice));
  if (!value) {
    return null;
  }

  const question = extractChoiceQuestion(choice, value);
  if (!question) {
    return null;
  }

  const normalizedQuestion = normalizeChoiceText(question);
  const normalizedValue = normalizeChoiceText(value);

  if (
    !normalizedQuestion ||
    normalizedQuestion === normalizedValue ||
    normalizedQuestion.includes(normalizedValue)
  ) {
    return null;
  }

  return { question, value };
}

function extractChoiceQuestion(
  choice: HTMLElement,
  value: string
): string {
  const valueKey = normalizeChoiceText(value);
  const container = choice.closest(QUESTION_CONTAINER_SELECTOR);
  const labelledQuestion =
    readLabelledQuestion(choice) || readLabelledQuestion(container);
  if (isUsableQuestionText(labelledQuestion, valueKey)) {
    return labelledQuestion;
  }

  if (!container) {
    return "";
  }

  const questionNodes = Array.from(
    container.querySelectorAll<HTMLElement>(
      "legend, label, .label, .question, .prompt, .title, [data-testid*='question'], [data-test*='question'], h1, h2, h3, h4, p, span"
    )
  );

  for (const node of questionNodes) {
    if (node === choice || node.contains(choice)) {
      continue;
    }

    if (
      node.closest(
        "button, [role='radio'], [role='checkbox'], [role='option'], [aria-checked], [aria-selected], [aria-pressed]"
      )
    ) {
      continue;
    }

    const text = cleanText(node.textContent);
    if (isUsableQuestionText(text, valueKey)) {
      return text;
    }
  }

  return "";
}

function readLabelledQuestion(element: Element | null): string {
  if (!(element instanceof Element)) {
    return "";
  }

  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    return cleanText(
      labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent || "")
        .join(" ")
    );
  }

  return cleanText(element.getAttribute("aria-label"));
}

function isUsableQuestionText(text: string, valueKey: string): boolean {
  const cleaned = cleanText(text);
  const normalized = normalizeChoiceText(cleaned);

  if (!cleaned || !normalized || normalized === valueKey) {
    return false;
  }

  if (
    [
      "yes",
      "no",
      "true",
      "false",
      "male",
      "female",
      "other",
      "prefer not to say",
    ].includes(normalized)
  ) {
    return false;
  }

  return looksLikeQuestion(cleaned) || normalized.split(" ").length >= 3;
}
