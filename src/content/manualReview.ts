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
