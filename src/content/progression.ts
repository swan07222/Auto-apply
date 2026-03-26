import { SiteKey, sleep } from "../shared";
import { isSelectBlank, shouldAutofillField } from "./autofill";
import { findProgressionAction } from "./apply";
import { performClickAction } from "./dom";
import { AutofillField, ProgressionAction } from "./types";

type HandleProgressionActionOptions = {
  site: SiteKey;
  progression: ProgressionAction;
  updateStatus: (message: string) => void;
  beforeAction?: () => Promise<void> | void;
  navigateCurrentTab: (url: string) => void;
  waitForHumanVerificationToClear: () => Promise<void>;
  hasLikelyApplicationSurface: (site: SiteKey) => boolean;
  waitForLikelyApplicationSurface: (site: SiteKey) => Promise<boolean>;
  reopenApplyStage: (site: SiteKey) => Promise<void>;
  collectAutofillFields: () => AutofillField[];
};

export async function waitForReadyProgressionAction(
  site: SiteKey,
  timeoutMs: number
): Promise<ProgressionAction | null> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const progression = findProgressionAction(site);
    if (progression) {
      return progression;
    }

    await sleep(250);
  }

  return null;
}

export async function handleProgressionAction({
  site,
  progression,
  updateStatus,
  beforeAction,
  navigateCurrentTab,
  waitForHumanVerificationToClear,
  hasLikelyApplicationSurface,
  waitForLikelyApplicationSurface,
  reopenApplyStage,
  collectAutofillFields,
}: HandleProgressionActionOptions): Promise<boolean> {
  updateStatus(`Clicking "${progression.text}"...`);

  const previousUrl = window.location.href;
  await beforeAction?.();

  if (progression.type === "navigate") {
    navigateCurrentTab(progression.url);
    return false;
  }

  if (site !== "monster") {
    progression.element.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
    await sleep(400);
  }
  performClickAction(progression.element, {
    skipFocus: site === "monster",
  });
  await sleep(site === "indeed" || site === "ziprecruiter" ? 3_400 : 2_800);

  if (window.location.href !== previousUrl) {
    await waitForHumanVerificationToClear();
    if (
      hasLikelyApplicationSurface(site) ||
      (await waitForLikelyApplicationSurface(site))
    ) {
      return true;
    }

    await reopenApplyStage(site);
    return false;
  }

  await waitForFormContentChange(collectAutofillFields);
  if (
    hasLikelyApplicationSurface(site) ||
    (await waitForLikelyApplicationSurface(site))
  ) {
    return true;
  }

  await reopenApplyStage(site);
  return false;
}

async function waitForFormContentChange(
  collectAutofillFields: () => AutofillField[]
): Promise<void> {
  const initial = collectAutofillFields().length;
  for (let i = 0; i < 12; i += 1) {
    await sleep(500);
    const current = collectAutofillFields().length;
    if (current !== initial) {
      return;
    }

    const blanks = collectAutofillFields().filter(
      (field) => shouldAutofillField(field) && isFieldBlank(field)
    );
    if (blanks.length > 0) {
      return;
    }
  }
}

function isFieldBlank(field: AutofillField): boolean {
  if (field instanceof HTMLInputElement) {
    if (field.type === "radio" || field.type === "checkbox") {
      return false;
    }
    if (field.type === "file") {
      return !field.files?.length;
    }
    return !field.value.trim();
  }

  if (field instanceof HTMLSelectElement) {
    return isSelectBlank(field);
  }

  return !field.value.trim();
}
