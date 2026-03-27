import {
  getQuestionText,
  isFieldRequired,
  isFieldContextVisible,
  isSelectBlank,
  shouldAutofillField,
} from "./autofill";
import { getActionText, isElementVisible } from "./dom";
import { cleanText } from "./text";
import { AutofillField } from "./types";

const MANUAL_REVIEW_ACTION_PATTERNS = [
  /\bback\b/,
  /\bprevious\b/,
  /\bedit\b/,
  /\bchange\b/,
];

const MANUAL_REVIEW_BLOCK_PATTERNS = [
  "back to search",
  "back to results",
  "edit profile",
  "edit profile name",
  "change profile",
];

const MANUAL_SUBMIT_ACTION_PATTERNS = [
  /\bsubmit(\s+your|\s+my)?\s+application\b/,
  /\bconfirm\s+and\s+submit\b/,
  /\bsend\s+application\b/,
  /^submit$/,
];

const MANUAL_SUBMIT_REVIEW_PATTERNS = [
  "please review your application",
  "review your application",
  "you will not be able to make changes after you submit",
  "before you submit your application",
  "review before submitting",
];

export function shouldStartManualReviewPause(
  target: EventTarget | null
): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const actionElement = target.closest<HTMLElement>(
    "button, a[href], [role='button'], input[type='button'], input[type='submit']"
  );
  if (!actionElement || !isElementVisible(actionElement)) {
    return false;
  }

  const text = cleanText(
    getActionText(actionElement) ||
      actionElement.getAttribute("aria-label") ||
      actionElement.getAttribute("title") ||
      ""
  ).toLowerCase();
  if (!text) {
    return false;
  }

  if (MANUAL_REVIEW_BLOCK_PATTERNS.some((pattern) => text.includes(pattern))) {
    return false;
  }

  return MANUAL_REVIEW_ACTION_PATTERNS.some((pattern) => pattern.test(text));
}

export function hasEditableAutofillFields(fields: AutofillField[]): boolean {
  return fields.some((field) => {
    if (!shouldAutofillField(field, true, true)) {
      return false;
    }

    if (field instanceof HTMLInputElement) {
      if (
        ["hidden", "submit", "button", "reset", "image", "search"].includes(
          field.type.toLowerCase()
        )
      ) {
        return false;
      }

      return !field.disabled && !field.readOnly;
    }

    if (field instanceof HTMLTextAreaElement) {
      return !field.disabled && !field.readOnly;
    }

    return !field.disabled;
  });
}

export function hasPendingRequiredAutofillFields(
  fields: AutofillField[]
): boolean {
  const requiredRadioGroups = new Set<string>();
  const checkedRadioGroups = new Set<string>();

  for (const field of fields) {
    if (!isFieldContextVisible(field)) {
      continue;
    }

    if (!isFieldRequired(field)) {
      continue;
    }

    if (field instanceof HTMLInputElement) {
      const type = field.type.toLowerCase();
      if (
        ["hidden", "submit", "button", "reset", "image", "search"].includes(
          type
        ) ||
        field.disabled ||
        field.readOnly
      ) {
        continue;
      }

      if (type === "radio") {
        const groupKey = field.name || field.id || getQuestionText(field);
        if (!groupKey) {
          if (!field.checked) {
            return true;
          }
          continue;
        }
        requiredRadioGroups.add(groupKey);
        if (field.checked) {
          checkedRadioGroups.add(groupKey);
        }
        continue;
      }

      if (type === "checkbox") {
        if (!field.checked) {
          return true;
        }
        continue;
      }

      if (type === "file") {
        if (!field.files?.length) {
          return true;
        }
        continue;
      }

      if (!field.value.trim()) {
        return true;
      }
      continue;
    }

    if (field instanceof HTMLSelectElement) {
      if (!field.disabled && isSelectBlank(field)) {
        return true;
      }
      continue;
    }

    if (
      field instanceof HTMLTextAreaElement &&
      !field.disabled &&
      !field.readOnly &&
      !field.value.trim()
    ) {
      return true;
    }
  }

  for (const groupKey of requiredRadioGroups) {
    if (!checkedRadioGroups.has(groupKey)) {
      return true;
    }
  }

  return false;
}

export function hasVisibleManualSubmitAction(
  root: ParentNode = document
): boolean {
  const candidates = Array.from(
    root.querySelectorAll<HTMLElement>(
      "button, input[type='submit'], input[type='button'], a[href], [role='button']"
    )
  );

  return candidates.some((candidate) => {
    if (!isElementVisible(candidate)) {
      return false;
    }

    const text = cleanText(
      getActionText(candidate) ||
        candidate.getAttribute("aria-label") ||
        candidate.getAttribute("title") ||
        ""
    ).toLowerCase();

    if (!text) {
      return false;
    }

    return MANUAL_SUBMIT_ACTION_PATTERNS.some((pattern) => pattern.test(text));
  });
}

export function isManualSubmitActionTarget(
  target: EventTarget | null
): boolean {
  return resolveManualSubmitActionElement(target) !== null;
}

export function resolveManualSubmitActionElement(
  target: EventTarget | null
): HTMLElement | null {
  if (!(target instanceof HTMLElement)) {
    return null;
  }

  const actionElement = target.closest<HTMLElement>(
    "button, input[type='submit'], input[type='button'], a[href], [role='button']"
  );
  if (!actionElement || !isElementVisible(actionElement)) {
    return null;
  }

  const text = cleanText(
    getActionText(actionElement) ||
      actionElement.getAttribute("aria-label") ||
      actionElement.getAttribute("title") ||
      ""
  ).toLowerCase();

  if (!text) {
    return null;
  }

  return MANUAL_SUBMIT_ACTION_PATTERNS.some((pattern) => pattern.test(text))
    ? actionElement
    : null;
}

export function shouldTreatManualSubmitActionAsReady(
  target: EventTarget | null,
  fields: AutofillField[]
): boolean {
  const actionElement = resolveManualSubmitActionElement(target);
  if (!actionElement) {
    return false;
  }

  if (
    actionElement.hasAttribute("disabled") ||
    actionElement.getAttribute("aria-disabled") === "true"
  ) {
    return false;
  }

  const associatedForm = resolveAssociatedSubmitForm(actionElement);
  if (associatedForm && !shouldSkipNativeSubmitValidation(actionElement)) {
    try {
      if (!associatedForm.checkValidity()) {
        return false;
      }
    } catch {
      // Ignore form validity errors and continue with field-based checks.
    }
  }

  const relevantFields = collectRelevantManualSubmitFields(
    actionElement,
    fields,
    associatedForm
  );
  if (hasPendingRequiredAutofillFields(relevantFields)) {
    return false;
  }

  return !hasVisibleInvalidAutofillFields(relevantFields);
}

export function isLikelyManualSubmitReviewPage(
  root: ParentNode = document
): boolean {
  const text = cleanText(
    root instanceof Document
      ? root.body?.innerText || root.body?.textContent || ""
      : root.textContent || ""
  )
    .toLowerCase()
    .slice(0, 5000);

  if (!text) {
    return false;
  }

  return MANUAL_SUBMIT_REVIEW_PATTERNS.some((pattern) =>
    text.includes(pattern)
  );
}

export function shouldPauseAutomationForManualReview(
  pauseUntil: number,
  fields: AutofillField[],
  now: number = Date.now()
): boolean {
  return now < pauseUntil && hasEditableAutofillFields(fields);
}

function resolveAssociatedSubmitForm(
  actionElement: HTMLElement
): HTMLFormElement | null {
  if (
    (actionElement instanceof HTMLButtonElement ||
      actionElement instanceof HTMLInputElement) &&
    actionElement.form
  ) {
    return actionElement.form;
  }

  const formAttribute = actionElement.getAttribute("form");
  if (formAttribute) {
    const formElement = document.getElementById(formAttribute);
    if (formElement instanceof HTMLFormElement) {
      return formElement;
    }
  }

  const closestForm = actionElement.closest("form");
  return closestForm instanceof HTMLFormElement ? closestForm : null;
}

function shouldSkipNativeSubmitValidation(actionElement: HTMLElement): boolean {
  return (
    (actionElement instanceof HTMLButtonElement ||
      actionElement instanceof HTMLInputElement) &&
    actionElement.formNoValidate
  );
}

function collectRelevantManualSubmitFields(
  actionElement: HTMLElement,
  fields: AutofillField[],
  associatedForm: HTMLFormElement | null
): AutofillField[] {
  if (associatedForm) {
    const formId = associatedForm.id.trim();
    return fields.filter((field) => {
      if (!isFieldContextVisible(field)) {
        return false;
      }
      if (associatedForm.contains(field)) {
        return true;
      }
      return formId.length > 0 && field.getAttribute("form") === formId;
    });
  }

  const container = actionElement.closest(
    "form, [role='dialog'], [aria-modal='true'], main, article, section"
  );
  if (!(container instanceof HTMLElement)) {
    return fields.filter((field) => isFieldContextVisible(field));
  }

  return fields.filter(
    (field) => isFieldContextVisible(field) && container.contains(field)
  );
}

function hasVisibleInvalidAutofillFields(fields: AutofillField[]): boolean {
  return fields.some((field) => {
    if (!isFieldContextVisible(field)) {
      return false;
    }

    if (
      field instanceof HTMLInputElement ||
      field instanceof HTMLTextAreaElement ||
      field instanceof HTMLSelectElement
    ) {
      try {
        if (field.matches(":invalid")) {
          return true;
        }
      } catch {
        // Ignore selector support issues and fall back to attribute checks.
      }
    }

    if (field.getAttribute("aria-invalid") === "true") {
      return true;
    }

    const fieldSignals = [
      field.className,
      field.getAttribute("data-testid"),
      field.getAttribute("data-test"),
      field.getAttribute("data-cy"),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (/\b(error|invalid|is-invalid|has-error|field-error)\b/.test(fieldSignals)) {
      return true;
    }

    const container = field.closest(
      "[aria-invalid='true'], .error, .errors, .invalid, .is-invalid, .has-error, [class*='error'], [class*='invalid']"
    );
    return container instanceof HTMLElement && isElementVisible(container);
  });
}
