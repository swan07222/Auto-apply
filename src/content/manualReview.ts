import { shouldAutofillField } from "./autofill";
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
    if (!shouldAutofillField(field, false, true)) {
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

export function shouldPauseAutomationForManualReview(
  pauseUntil: number,
  fields: AutofillField[],
  now: number = Date.now()
): boolean {
  return now < pauseUntil && hasEditableAutofillFields(fields);
}
