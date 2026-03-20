import {
  getOptionLabelText,
  isConsentField,
  normalizeBooleanAnswer,
  scoreChoiceMatch,
} from "./autofill";
import { cssEscape, normalizeChoiceText } from "./text";

export function applyAnswerToRadioGroup(
  field: HTMLInputElement,
  answer: string,
  allowOverwrite = false
): boolean {
  const radios = getGroupedInputs(field, "radio");
  const best = findBestChoice(radios, answer);

  if (!best) {
    return false;
  }

  if (best.checked) {
    return false;
  }

  if (!allowOverwrite && radios.some((radio) => radio.checked)) {
    return false;
  }

  best.checked = true;
  best.dispatchEvent(new Event("input", { bubbles: true }));
  best.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

export function applyAnswerToCheckbox(
  field: HTMLInputElement,
  answer: string
): boolean {
  const boxes = getGroupedInputs(field, "checkbox");

  if (boxes.length > 1) {
    const values = answer
      .split(/[,;|]/)
      .map((entry) => normalizeChoiceText(entry))
      .filter(Boolean);

    if (!values.length) {
      return false;
    }

    let changed = false;
    for (const box of boxes) {
      const optionText = normalizeChoiceText(getOptionLabelText(box) || box.value);
      if (
        values.some((value) => optionText.includes(value) || value.includes(optionText)) &&
        !box.checked
      ) {
        box.checked = true;
        box.dispatchEvent(new Event("input", { bubbles: true }));
        box.dispatchEvent(new Event("change", { bubbles: true }));
        changed = true;
      }
    }
    return changed;
  }

  if (isConsentField(field)) {
    return false;
  }

  const bool = normalizeBooleanAnswer(answer);
  if (bool === null || field.checked === bool) {
    return false;
  }

  field.checked = bool;
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

export function selectOptionByAnswer(
  select: HTMLSelectElement,
  answer: string
): boolean {
  const normalizedAnswer = normalizeChoiceText(answer);
  let bestOption: HTMLOptionElement | null = null;
  let bestScore = -1;

  for (const option of Array.from(select.options)) {
    const score = scoreChoiceMatch(
      normalizedAnswer,
      `${normalizeChoiceText(option.textContent || "")} ${normalizeChoiceText(option.value)}`
    );
    if (score > bestScore) {
      bestOption = option;
      bestScore = score;
    }
  }

  if (!bestOption || bestScore <= 0 || select.value === bestOption.value) {
    return false;
  }

  select.value = bestOption.value;
  select.dispatchEvent(new Event("input", { bubbles: true }));
  select.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

function findBestChoice(
  inputs: HTMLInputElement[],
  answer: string
): HTMLInputElement | null {
  const normalizedAnswer = normalizeChoiceText(answer);
  let best: HTMLInputElement | null = null;
  let bestScore = -1;

  for (const input of inputs) {
    const score = scoreChoiceMatch(
      normalizedAnswer,
      normalizeChoiceText(`${getOptionLabelText(input)} ${input.value}`)
    );
    if (score > bestScore) {
      best = input;
      bestScore = score;
    }
  }

  return best && bestScore > 0 ? best : null;
}

function getGroupedInputs(
  field: HTMLInputElement,
  type: "radio" | "checkbox"
): HTMLInputElement[] {
  if (!field.name) {
    return [field];
  }

  try {
    return Array.from(
      (field.form ?? document).querySelectorAll<HTMLInputElement>(
        `input[type='${type}'][name='${cssEscape(field.name)}']`
      )
    );
  } catch {
    return [field];
  }
}
