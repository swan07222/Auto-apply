import { shouldAutofillField } from "./autofill";
import { isLikelyApplicationField } from "./applicationSurface";
import { getSelectedFileName } from "./resumeUpload";
import { AutofillField } from "./types";

type ResumeStepCollectors = {
  collectAutofillFields: () => AutofillField[];
  collectResumeFileInputs: () => HTMLInputElement[];
};

export function hasSelectedResumeUpload(input: HTMLInputElement): boolean {
  return Boolean(input.files?.length) || Boolean(getSelectedFileName(input));
}

export function isResumeUploadOnlySurface(
  collectors: ResumeStepCollectors
): boolean {
  return (
    collectLikelyResumeInputs(collectors).length > 0 &&
    collectLikelyNonFileApplicationFields(collectors).length === 0
  );
}

export function hasPendingResumeUploadSurface(
  collectors: ResumeStepCollectors
): boolean {
  const resumeInputs = collectLikelyResumeInputs(collectors);
  if (resumeInputs.length === 0) {
    return false;
  }

  if (resumeInputs.some((input) => !hasSelectedResumeUpload(input))) {
    return true;
  }

  return collectLikelyNonFileApplicationFields(collectors).length === 0;
}

function collectLikelyResumeInputs(
  collectors: ResumeStepCollectors
): HTMLInputElement[] {
  return collectors.collectResumeFileInputs().filter(
    (input) => shouldAutofillField(input, true) && isLikelyApplicationField(input)
  );
}

function collectLikelyNonFileApplicationFields(
  collectors: ResumeStepCollectors
): AutofillField[] {
  return collectors.collectAutofillFields().filter((field) => {
    if (field instanceof HTMLInputElement && field.type === "file") {
      return false;
    }

    return shouldAutofillField(field, true) && isLikelyApplicationField(field);
  });
}
