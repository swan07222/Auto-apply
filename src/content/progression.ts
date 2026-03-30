import { SiteKey, sleep } from "../shared";
import { isSelectBlank, shouldAutofillField } from "./autofill";
import { findProgressionAction } from "./apply";
import { performClickAction } from "./dom";
import { AutofillField, ProgressionAction } from "./types";

const PROGRESSION_POLL_MS = 125;
const IN_PLACE_FORM_CHANGE_DELAYS_MS = [
  200, 200, 250, 250, 300, 300, 400, 400, 500, 500,
];

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

    await sleep(PROGRESSION_POLL_MS);
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
  await waitForProgressionTransition({
    previousUrl,
    site,
    hasLikelyApplicationSurface,
  });

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
  for (const delayMs of IN_PLACE_FORM_CHANGE_DELAYS_MS) {
    await sleep(delayMs);
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

async function waitForProgressionTransition({
  previousUrl,
  site,
  hasLikelyApplicationSurface,
}: {
  previousUrl: string;
  site: SiteKey;
  hasLikelyApplicationSurface: (site: SiteKey) => boolean;
}): Promise<void> {
  const deadline =
    Date.now() + (site === "indeed" || site === "ziprecruiter" ? 2_200 : 1_600);

  while (Date.now() < deadline) {
    if (
      window.location.href !== previousUrl ||
      hasLikelyApplicationSurface(site)
    ) {
      return;
    }

    await sleep(PROGRESSION_POLL_MS);
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
