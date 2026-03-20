import { AutofillField } from "./types";
import { isElementVisible } from "./dom";
import { cleanText, cssEscape, normalizeChoiceText } from "./text";

const STABLE_PROFILE_FIELD_TOKENS = [
  "full name",
  "first name",
  "last name",
  "given name",
  "family name",
  "surname",
  "email",
  "phone",
  "mobile",
  "telephone",
  "linkedin",
  "portfolio",
  "website",
  "personal site",
  "github",
  "city",
  "state",
  "province",
  "region",
  "country",
  "current company",
  "current employer",
  "years of experience",
  "year of experience",
  "total experience",
  "overall experience",
  "authorized to work",
  "work authorization",
  "eligible to work",
  "legally authorized",
  "sponsorship",
  "visa",
  "relocate",
  "relocation",
] as const;

export function shouldAutofillField(
  field: AutofillField,
  ignoreBlankCheck = false,
  includeOptionalFields = false
): boolean {
  if (field.disabled) return false;
  if (field instanceof HTMLInputElement) {
    const inputType = field.type.toLowerCase();
    if (["hidden", "submit", "button", "reset", "image"].includes(inputType)) {
      return false;
    }
    if (inputType === "file") return true;
    if (!isFieldContextVisible(field)) return false;
    if (!ignoreBlankCheck && (inputType === "radio" || inputType === "checkbox")) {
      return true;
    }
  } else if (!isFieldContextVisible(field)) {
    return false;
  }

  const descriptor = getFieldDescriptor(field, getQuestionText(field));
  if (
    matchesDescriptor(descriptor, [
      "job title",
      "keywords",
      "search jobs",
      "find jobs",
      "job search",
      "search by keyword",
    ])
  ) {
    return false;
  }
  if (descriptor === "what" || descriptor === "where" || descriptor === "search" || descriptor === "q") {
    return false;
  }
  if (
    descriptor.includes("captcha") ||
    descriptor.includes("social security") ||
    descriptor.includes("ssn") ||
    descriptor.includes("password") ||
    descriptor.includes("credit card") ||
    descriptor.includes("card number")
  ) {
    return false;
  }
  if (
    !includeOptionalFields &&
    !(field instanceof HTMLInputElement && field.type.toLowerCase() === "file") &&
    !isFieldRequired(field)
  ) {
    return false;
  }
  if (!ignoreBlankCheck && field instanceof HTMLSelectElement) {
    return isSelectBlank(field);
  }
  return true;
}

export function isTextLikeInput(field: HTMLInputElement): boolean {
  return ["text", "email", "tel", "url", "number", "search", "date", "month", "week"].includes(
    field.type.toLowerCase()
  );
}

export function isSelectBlank(field: HTMLSelectElement): boolean {
  return (
    !field.value ||
    field.selectedIndex <= 0 ||
    /^select\b|^choose\b|please select|^--/i.test(field.selectedOptions[0]?.textContent || "")
  );
}

export function shouldOverwriteAutofillValue(
  field: AutofillField,
  answer: string,
  question = getQuestionText(field)
): boolean {
  if (!answer.trim() || document.activeElement === field) {
    return false;
  }

  const descriptor = getFieldDescriptor(field, question);
  if (!matchesDescriptor(descriptor, [...STABLE_PROFILE_FIELD_TOKENS])) {
    return false;
  }

  if (field instanceof HTMLTextAreaElement) {
    return false;
  }

  if (field instanceof HTMLSelectElement) {
    if (isSelectBlank(field)) {
      return true;
    }

    const current = cleanText(field.selectedOptions[0]?.textContent || field.value);
    return scoreChoiceMatch(answer, current) < 100;
  }

  if (!(field instanceof HTMLInputElement) || !isTextLikeInput(field)) {
    return false;
  }

  const current = normalizeAutofillComparableValue(field.value);
  const desired = normalizeAutofillComparableValue(answer);
  if (!current || current === desired) {
    return false;
  }

  if (isPlaceholderLikeValue(current)) {
    return true;
  }

  return true;
}

export function setFieldValue(
  field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string
): void {
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value");
  if (descriptor?.set) descriptor.set.call(field, value);
  else field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(new Event("change", { bubbles: true }));
  field.dispatchEvent(new Event("blur", { bubbles: true }));
}

export function getQuestionText(field: AutofillField | HTMLInputElement): string {
  const legend = cleanText(field.closest("fieldset")?.querySelector("legend")?.textContent);
  if (legend) return legend;

  const labelledBy = field.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = cleanText(
      labelledBy
        .split(/\s+/)
        .map((id) => findByIdNearField(field, id)?.textContent ?? "")
        .join(" ")
    );
    if (text) return text;
  }

  const label = getAssociatedLabelText(field);
  if (label) return label;

  const wrapper = cleanText(
    field
      .closest(
        "label, [role='group'], .field, .form-field, .question, .application-question, [class*='form-group'], [class*='field-wrapper']"
      )
      ?.querySelector("label, .label, .question, .prompt, .title, span")?.textContent
  );
  if (wrapper) return wrapper;

  return (
    cleanText(field.getAttribute("aria-label")) ||
    cleanText(field.getAttribute("placeholder")) ||
    cleanText(field.getAttribute("name")) ||
    cleanText(field.getAttribute("id")) ||
    ""
  );
}

export function getAssociatedLabelText(field: Element): string {
  const id = field.getAttribute("id");
  if (id) {
    try {
      const root = getFieldLookupRoot(field);
      const label = cleanText(
        root.querySelector(`label[for='${cssEscape(id)}']`)?.textContent ||
          document.querySelector(`label[for='${cssEscape(id)}']`)?.textContent
      );
      if (label) return label;
    } catch {
      // Ignore invalid selectors.
    }
  }

  return cleanText(field.closest("label")?.textContent);
}

export function getOptionLabelText(field: HTMLInputElement): string {
  return getAssociatedLabelText(field) || cleanText(field.parentElement?.textContent) || "";
}

export function getFieldDescriptor(
  field: AutofillField | HTMLInputElement,
  question: string
): string {
  return normalizeChoiceText(
    [
      question,
      field.getAttribute("name"),
      field.getAttribute("id"),
      field.getAttribute("placeholder"),
      field.getAttribute("aria-label"),
      field.getAttribute("autocomplete"),
      field instanceof HTMLInputElement ? field.type : "",
    ]
      .filter(Boolean)
      .join(" ")
  );
}

export function matchesDescriptor(descriptor: string, phrases: string[]): boolean {
  return phrases.some((phrase) => descriptor.includes(normalizeChoiceText(phrase)));
}

export function scoreChoiceMatch(answer: string, candidate: string): number {
  if (!answer || !candidate) return -1;

  const normalizedAnswer = normalizeChoiceText(answer);
  const normalizedCandidate = normalizeChoiceText(candidate);
  if (!normalizedAnswer || !normalizedCandidate) return -1;
  if (normalizedAnswer === normalizedCandidate) return 100;

  const normalizedBoolean = normalizeBooleanAnswer(normalizedAnswer);
  if (normalizedBoolean !== null) {
    if (
      normalizedBoolean &&
      ["yes", "true", "authorized", "eligible", "i am", "i do", "i have", "i will"].some(
        (word) => normalizedCandidate.includes(word)
      )
    ) {
      return 80;
    }
    if (
      !normalizedBoolean &&
      ["no", "false", "not authorized", "i am not", "i do not", "i don t"].some((word) =>
        normalizedCandidate.includes(word)
      )
    ) {
      return 80;
    }
  }

  if (normalizedCandidate.includes(normalizedAnswer) || normalizedAnswer.includes(normalizedCandidate)) {
    return 70;
  }

  return 0;
}

export function normalizeBooleanAnswer(answer: string): boolean | null {
  const normalized = normalizeChoiceText(answer);
  if (["yes", "y", "true", "authorized", "eligible", "1"].includes(normalized)) return true;
  if (["no", "n", "false", "not authorized", "0"].includes(normalized)) return false;
  return null;
}

export function isConsentField(field: HTMLInputElement): boolean {
  const descriptor = getFieldDescriptor(field, getQuestionText(field));
  return ["privacy", "terms", "agree", "consent", "policy", "acknowledge", "accept", "gdpr"].some(
    (token) => descriptor.includes(token)
  );
}

export function isFieldRequired(field: AutofillField): boolean {
  if (field.hasAttribute("required") || field.getAttribute("aria-required") === "true") {
    return true;
  }

  if (field.getAttribute("aria-required") === "false" || field.getAttribute("data-required") === "false") {
    return false;
  }

  if (/\*/.test(getQuestionText(field))) {
    return true;
  }

  const container = field.closest(
    "label, fieldset, [role='group'], [role='radiogroup'], [role='dialog'], .field, .form-field, .question, .application-question, [class*='field'], [class*='question'], [class*='required'], [data-required]"
  );

  if (!(container instanceof HTMLElement)) {
    return false;
  }

  if (isFieldExplicitlyOptional(field, container)) {
    return false;
  }

  const attrs = [
    container.className,
    container.getAttribute("data-required"),
    container.getAttribute("aria-required"),
  ]
    .join(" ")
    .toLowerCase();

  if (attrs.includes("required")) {
    return true;
  }

  const labelText = cleanText(
    container.querySelector("label, legend, .label, .question, .prompt, .title")?.textContent
  );
  return /\*/.test(labelText);
}

export function shouldRememberField(field: AutofillField): boolean {
  const descriptor = getFieldDescriptor(field, getQuestionText(field));
  if (
    descriptor.includes("password") ||
    descriptor.includes("social security") ||
    descriptor.includes("ssn") ||
    descriptor.includes("date of birth") ||
    descriptor.includes("dob") ||
    descriptor.includes("resume") ||
    descriptor.includes("credit card") ||
    descriptor.includes("card number") ||
    descriptor.includes("cvv") ||
    descriptor.includes("expiry")
  ) {
    return false;
  }
  if (
    matchesDescriptor(descriptor, [
      ...STABLE_PROFILE_FIELD_TOKENS,
    ])
  ) {
    return false;
  }
  if (field instanceof HTMLInputElement && field.type === "file") {
    return false;
  }
  return true;
}

export function readFieldAnswerForMemory(field: AutofillField): string {
  if (field instanceof HTMLSelectElement) {
    return cleanText(field.selectedOptions[0]?.textContent || field.value);
  }
  if (field instanceof HTMLTextAreaElement) {
    return field.value.trim();
  }
  if ((field as HTMLInputElement).type === "radio") {
    return (field as HTMLInputElement).checked
      ? getOptionLabelText(field as HTMLInputElement) || (field as HTMLInputElement).value
      : "";
  }
  if ((field as HTMLInputElement).type === "checkbox") {
    return (field as HTMLInputElement).checked ? "Yes" : "No";
  }
  return (field as HTMLInputElement).value.trim();
}

function getFieldLookupRoot(field: Element): Document | ShadowRoot {
  const root = field.getRootNode();
  return root instanceof ShadowRoot ? root : document;
}

function findByIdNearField(field: Element, id: string): HTMLElement | null {
  try {
    const selector = `#${cssEscape(id)}`;
    const root = getFieldLookupRoot(field);
    return root.querySelector<HTMLElement>(selector) ?? document.querySelector<HTMLElement>(selector);
  } catch {
    return null;
  }
}

function isFieldContextVisible(field: AutofillField): boolean {
  if (isElementVisible(field)) return true;

  for (const label of Array.from(field.labels ?? [])) {
    if (label instanceof HTMLElement && isElementVisible(label)) {
      return true;
    }
  }

  const container = field.closest(
    "label, fieldset, form, [role='group'], [role='radiogroup'], [role='dialog'], .field, .form-field, .question, .application-question, [class*='field'], [class*='question']"
  );
  if (container instanceof HTMLElement && isElementVisible(container)) {
    return true;
  }

  const root = field.getRootNode();
  return root instanceof ShadowRoot && root.host instanceof HTMLElement && isElementVisible(root.host);
}

function isFieldExplicitlyOptional(
  field: AutofillField,
  container?: HTMLElement | null
): boolean {
  if (/\boptional\b/i.test(getQuestionText(field))) {
    return true;
  }

  const fieldSignals = [
    field.getAttribute("aria-required"),
    field.getAttribute("data-required"),
    field.getAttribute("aria-label"),
    field.getAttribute("placeholder"),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (
    fieldSignals.includes("optional") ||
    field.getAttribute("aria-required") === "false" ||
    field.getAttribute("data-required") === "false"
  ) {
    return true;
  }

  const context = container ?? field.closest(
    "label, fieldset, [role='group'], [role='radiogroup'], [role='dialog'], .field, .form-field, .question, .application-question, [class*='field'], [class*='question'], [class*='optional'], [data-required], [aria-required]"
  );
  if (!(context instanceof HTMLElement)) {
    return false;
  }

  const attrs = [
    context.className,
    context.getAttribute("data-required"),
    context.getAttribute("aria-required"),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (
    attrs.includes("optional") ||
    context.getAttribute("aria-required") === "false" ||
    context.getAttribute("data-required") === "false"
  ) {
    return true;
  }

  return /\boptional\b/i.test(cleanText(context.textContent || ""));
}

function normalizeAutofillComparableValue(value: string): string {
  return normalizeChoiceText(value).replace(/\s+/g, " ").trim();
}

function isPlaceholderLikeValue(value: string): boolean {
  return [
    "select",
    "choose",
    "none",
    "n a",
    "na",
    "unknown",
    "not provided",
    "not specified",
    "pending",
  ].some((token) => value === token || value.startsWith(`${token} `));
}
