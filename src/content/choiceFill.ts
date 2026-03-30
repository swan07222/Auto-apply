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

  return applyChoiceInputState(best, true);
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
        changed = applyChoiceInputState(box, true) || changed;
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

  return applyChoiceInputState(field, bool);
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

function applyChoiceInputState(
  input: HTMLInputElement,
  desiredChecked: boolean
): boolean {
  if (input.checked === desiredChecked) {
    return false;
  }

  const descriptor = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(input),
    "checked"
  );
  if (descriptor?.set) {
    descriptor.set.call(input, desiredChecked);
  } else {
    input.checked = desiredChecked;
  }

  try {
    input.dispatchEvent(
      new Event("click", {
        bubbles: true,
        cancelable: true,
      })
    );
  } catch {
    // Ignore click-dispatch issues and still emit the standard change events.
  }

  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return input.checked === desiredChecked;
}
