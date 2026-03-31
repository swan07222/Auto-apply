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
  "location",
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

const BLOCKED_REMEMBER_DESCRIPTOR_TOKENS = [
  "search jobs",
  "job search",
  "search by keyword",
  "search location",
  "radius",
  "distance",
  "miles",
  "captcha",
  "recaptcha",
  "hcaptcha",
  "csrf",
  "requestverificationtoken",
  "verification token",
  "authenticity token",
  "viewstate",
  "eventvalidation",
] as const;

const BLOCKED_REMEMBER_IDENTIFIER_PATTERNS = [
  /^q$/i,
  /^query$/i,
  /^search$/i,
  /^keywords?$/i,
  /^radius$/i,
  /^distance$/i,
  /^_{1,2}[a-z0-9_:-]+$/i,
  /requestverificationtoken/i,
  /verificationtoken/i,
  /authenticitytoken/i,
  /csrf/i,
  /captcha/i,
  /recaptcha/i,
  /viewstate/i,
  /eventvalidation/i,
] as const;

const QUESTION_TEXT_CONTAINER_SELECTOR = [
  "label",
  "fieldset",
  "[role='group']",
  "[role='radiogroup']",
  "[role='dialog']",
  ".field",
  ".form-field",
  ".question",
  ".application-question",
  "[class*='form-group']",
  "[class*='field-wrapper']",
  "[class*='field']",
  "[class*='question']",
  "[data-testid*='question']",
  "[data-test*='question']",
].join(", ");

const QUESTION_TEXT_NODE_SELECTOR = [
  "legend",
  "label",
  ".label",
  ".question",
  ".prompt",
  ".title",
  "[data-testid*='question']",
  "[data-test*='question']",
  "h1",
  "h2",
  "h3",
  "h4",
  "p",
  "span",
  "div",
].join(", ");

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
    descriptor.includes("card number") ||
    descriptor.includes("cvv") ||
    descriptor.includes("expiry") ||
    descriptor.includes("bank account") ||
    descriptor.includes("routing number") ||
    descriptor.includes("driver license") ||
    descriptor.includes("passport")
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

  if (field.hasAttribute("readonly") || field.getAttribute("aria-readonly") === "true") {
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

  if (field.value.length > 0 && field.value !== field.defaultValue) {
    return false;
  }

  return true;
}

export function setFieldValue(
  field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string
): void {
  if (field.hasAttribute("readonly") || field.getAttribute("aria-readonly") === "true") {
    return;
  }

  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value");
  if (descriptor?.set) {
    try {
      descriptor.set.call(field, value);
    } catch {
      field.value = value;
    }
  } else {
    field.value = value;
  }

  try {
    field.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
  } catch {
    // Ignore input event dispatch failures.
  }

  try {
    field.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
  } catch {
    // Ignore change event dispatch failures.
  }

  if (document.activeElement !== field) {
    try {
      field.dispatchEvent(new Event("blur", { bubbles: true }));
    } catch {
      // Ignore blur event dispatch failures.
    }
  }
}

export function getQuestionText(field: AutofillField | HTMLInputElement): string {
  const legend = cleanText(field.closest("fieldset")?.querySelector("legend")?.textContent);
  if (legend) return legend;

  const labelledBy = readFieldReferenceText(field, "aria-labelledby");
  if (labelledBy) return labelledBy;

  const describedBy = readFieldReferenceText(field, "aria-describedby");
  if (describedBy) return describedBy;

  const label = getAssociatedLabelText(field);
  if (label) return label;

  const promptText = getPromptQuestionText(field);
  if (promptText) return promptText;

  const wrapper = cleanText(
    field
      .closest(
        "label, [role='group'], .field, .form-field, .question, .application-question, [class*='form-group'], [class*='field-wrapper']"
      )
      ?.querySelector("label, .label, .question, .prompt, .title, span, p, h1, h2, h3, h4")?.textContent
  );
  if (wrapper) return wrapper;

  const headingSibling = findHeadingSibling(field);
  if (headingSibling) return headingSibling;

  return (
    cleanText(field.getAttribute("aria-label")) ||
    cleanText(field.getAttribute("placeholder")) ||
    cleanText(field.getAttribute("name")) ||
    cleanText(field.getAttribute("id")) ||
    ""
  );
}

function findHeadingSibling(field: AutofillField | HTMLInputElement): string {
  const parent = field.parentElement;
  if (!parent) return "";

  const previousSibling = parent.previousElementSibling;
  if (!previousSibling) return "";

  const heading = previousSibling.querySelector("h1, h2, h3, h4, h5, h6, .title, .heading");
  if (heading) {
    const text = cleanText(heading.textContent);
    if (text && text.length < 200) {
      return text;
    }
  }

  return "";
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

function readFieldReferenceText(
  field: AutofillField | HTMLInputElement,
  attributeName: "aria-labelledby" | "aria-describedby"
): string {
  const referenceIds = field.getAttribute(attributeName);
  if (!referenceIds) {
    return "";
  }

  return cleanText(
    referenceIds
      .split(/\s+/)
      .map((id) => findByIdNearField(field, id)?.textContent ?? "")
      .join(" ")
  );
}

function getPromptQuestionText(field: AutofillField | HTMLInputElement): string {
  const container = field.closest(QUESTION_TEXT_CONTAINER_SELECTOR);
  if (!container) {
    return "";
  }

  const candidates = Array.from(
    container.querySelectorAll<HTMLElement>(QUESTION_TEXT_NODE_SELECTOR)
  );

  for (const candidate of candidates) {
    if (
      candidate === field ||
      candidate.contains(field) ||
      candidate.closest(
        "button, a[href], [role='button'], [role='option'], [role='radio'], [role='checkbox']"
      )
    ) {
      continue;
    }

    if (
      candidate.tagName === "DIV" &&
      candidate.querySelector("input, textarea, select, button, a[href]")
    ) {
      continue;
    }

    const text = cleanText(candidate.textContent || "");
    if (!isUsableQuestionPrompt(text)) {
      continue;
    }

    return text;
  }

  return "";
}

function isUsableQuestionPrompt(text: string): boolean {
  if (!text) {
    return false;
  }

  const normalized = normalizeChoiceText(text);
  if (!normalized) {
    return false;
  }

  if (
    text.length > 180 ||
    normalized.split(/\s+/).length > 24 ||
    normalized === "required" ||
    normalized === "optional"
  ) {
    return false;
  }

  return true;
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
      ["yes", "true", "authorized", "eligible", "i am", "i do", "i have", "i will", "absolutely", "definitely"].some(
        (word) => normalizedCandidate.includes(word)
      )
    ) {
      return 80;
    }
    if (
      !normalizedBoolean &&
      ["no", "false", "not authorized", "i am not", "i do not", "i don t", "never", "none"].some((word) =>
        normalizedCandidate.includes(word)
      )
    ) {
      return 80;
    }
  }

  if (normalizedCandidate.includes(normalizedAnswer) || normalizedAnswer.includes(normalizedCandidate)) {
    return 70;
  }

  const answerWords = normalizedAnswer.split(/\s+/).filter((w) => w.length > 2);
  const candidateWords = normalizedCandidate.split(/\s+/).filter((w) => w.length > 2);
  
  if (answerWords.length > 0 && candidateWords.length > 0) {
    const matches = answerWords.filter((word) => candidateWords.some((cw) => cw.includes(word) || word.includes(cw)));
    const matchRatio = matches.length / Math.max(answerWords.length, candidateWords.length);
    if (matchRatio >= 0.6) {
      return Math.round(50 + matchRatio * 20);
    }
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
    container.getAttribute("data-test"),
    container.getAttribute("data-testid"),
  ]
    .join(" ")
    .toLowerCase();

  if (attrs.includes("required") || attrs.includes("is-required") || attrs.includes("required-field")) {
    return true;
  }

  const labelText = cleanText(
    container.querySelector("label, legend, .label, .question, .prompt, .title")?.textContent
  );
  if (/\*/.test(labelText)) {
    return true;
  }

  const hasRequiredClass = /\b(required|is-required|required-field|field-required)\b/.test(
    container.className.toLowerCase()
  );
  if (hasRequiredClass) {
    return true;
  }

  return false;
}

export function shouldRememberField(field: AutofillField): boolean {
  if (
    field instanceof HTMLInputElement &&
    (field.type === "checkbox" || field.type === "radio") &&
    isConsentField(field)
  ) {
    return false;
  }

  if (
    field instanceof HTMLInputElement &&
    ["hidden", "search", "password"].includes(field.type.toLowerCase())
  ) {
    return false;
  }

  const descriptor = getFieldDescriptor(field, getQuestionText(field));
  if (
    descriptor.includes("password") ||
    descriptor.includes("social security") ||
    descriptor.includes("ssn") ||
    descriptor.includes("date of birth") ||
    descriptor.includes("dob") ||
    descriptor.includes("age") ||
    descriptor.includes("birth date") ||
    descriptor.includes("resume") ||
    descriptor.includes("credit card") ||
    descriptor.includes("card number") ||
    descriptor.includes("cvv") ||
    descriptor.includes("expiry") ||
    descriptor.includes("bank account") ||
    descriptor.includes("routing number") ||
    descriptor.includes("driver license") ||
    descriptor.includes("passport") ||
    descriptor.includes("gender") ||
    descriptor.includes("marital status") ||
    descriptor.includes("ethnicity") ||
    descriptor.includes("race") ||
    descriptor.includes("veteran") ||
    descriptor.includes("disability")
  ) {
    return false;
  }
  if (
    matchesDescriptor(descriptor, [...BLOCKED_REMEMBER_DESCRIPTOR_TOKENS]) ||
    looksLikeBlockedRememberFieldIdentifier(field)
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

function looksLikeBlockedRememberFieldIdentifier(field: AutofillField): boolean {
  const identifiers = [
    field.getAttribute("name"),
    field.getAttribute("id"),
    field.getAttribute("autocomplete"),
    field.getAttribute("placeholder"),
    field.getAttribute("aria-label"),
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim());

  return identifiers.some((identifier) =>
    BLOCKED_REMEMBER_IDENTIFIER_PATTERNS.some((pattern) => pattern.test(identifier))
  );
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

export function isFieldContextVisible(field: AutofillField): boolean {
  if (hasHiddenAncestor(field)) {
    return false;
  }

  if (isElementVisible(field)) return true;

  for (const label of Array.from(field.labels ?? [])) {
    if (label instanceof HTMLElement && isElementVisible(label)) {
      return true;
    }
  }

  const container = field.closest(
    "label, fieldset, [role='group'], [role='radiogroup'], [role='dialog'], .field, .form-field, .question, .application-question, [class*='field'], [class*='question']"
  );
  if (container instanceof HTMLElement && isElementVisible(container)) {
    return true;
  }

  const root = field.getRootNode();
  if (root instanceof ShadowRoot && root.host instanceof HTMLElement && isElementVisible(root.host)) {
    return true;
  }

  if (root instanceof Document && window.location !== window.top?.location) {
    try {
      const iframe = Array.from(document.querySelectorAll("iframe")).find(
        (frame) => frame.contentDocument === root
      );
      if (iframe && isElementVisible(iframe)) {
        return true;
      }
    } catch {
      // Cross-origin iframe, cannot check visibility.
    }
  }

  return false;
}

function hasHiddenAncestor(field: AutofillField): boolean {
  let current: Element | null = field.parentElement;

  while (current) {
    if (current instanceof HTMLElement) {
      const styles = window.getComputedStyle(current);
      const opacity = Number.parseFloat(styles.opacity);

      if (
        styles.visibility === "hidden" ||
        styles.visibility === "collapse" ||
        styles.display === "none" ||
        (Number.isFinite(opacity) && opacity <= 0.01)
      ) {
        return true;
      }
    }

    current = current.parentElement;
  }

  return false;
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
