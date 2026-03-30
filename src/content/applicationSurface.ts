import { sleep, SiteKey } from "../shared";
import {
  getFieldDescriptor,
  getQuestionText,
  matchesDescriptor,
  shouldAutofillField,
} from "./autofill";
import { collectDeepMatches, isElementVisible, normalizeUrl } from "./dom";
import {
  findApplyAction,
  findCompanySiteAction,
  findProgressionAction,
  hasIndeedApplyIframe,
  hasZipRecruiterApplyModal,
  isAlreadyOnApplyPage,
} from "./apply";
import { cleanText, normalizeChoiceText } from "./text";
import { AutofillField } from "./types";

type ApplicationSurfaceCollectors = {
  collectAutofillFields: () => AutofillField[];
  collectResumeFileInputs: () => HTMLInputElement[];
};

const APPLICATION_FRAME_SELECTOR =
  "iframe[src*='apply'], iframe[src*='application'], iframe[id*='apply'], iframe[class*='apply'], iframe[src*='greenhouse'], iframe[src*='lever'], iframe[src*='workday'], iframe[data-src*='apply'], iframe[data-src*='application'], iframe[data-src*='greenhouse'], iframe[data-src*='lever'], iframe[data-src*='workday']";
const MONSTER_APPLICATION_SHELL_SELECTOR =
  "[role='dialog'], [aria-modal='true'], [class*='modal'], [class*='drawer'], [class*='overlay'], [class*='sheet'], [class*='popup'], [data-testid*='apply'], [data-testid*='application'], [data-testid*='candidate'], [data-testid*='resume'], [data-test*='apply'], [data-test*='application'], [data-test*='candidate'], [data-test*='resume'], [class*='application'], [class*='candidate'], [class*='resume'], [class*='upload'], [id*='application'], [id*='candidate'], [id*='resume']";
const GREENHOUSE_LAUNCH_SHELL_SELECTOR =
  "[role='dialog'], [aria-modal='true'], [class*='modal'], [class*='drawer'], [class*='overlay'], [class*='sheet'], [class*='popup'], [data-testid*='apply'], [data-testid*='application'], [data-testid*='greenhouse'], [data-test*='apply'], [data-test*='application'], [data-test*='greenhouse'], [class*='application'], [class*='candidate'], [class*='resume'], [class*='greenhouse'], [id*='application'], [id*='candidate'], [id*='resume'], [id*='greenhouse']";
const APPLICATION_SURFACE_WAIT_DELAYS_MS = [
  150, 150, 200, 200, 250, 250, 300, 300, 350, 350, 450, 450, 600, 600, 750,
  750, 900, 900, 1_000, 1_000,
];
const APPLICATION_SURFACE_SCROLL_ATTEMPTS = new Set([2, 4, 8, 12, 16]);
const GREENHOUSE_APPLICATION_SURFACE_SCROLL_ATTEMPTS = new Set([
  0, 1, 2, 4, 6, 8, 10, 12, 14, 16, 18,
]);

export async function waitForLikelyApplicationSurface(
  site: SiteKey,
  collectors: ApplicationSurfaceCollectors
): Promise<boolean> {
  for (
    let attempt = 0;
    attempt < APPLICATION_SURFACE_WAIT_DELAYS_MS.length;
    attempt += 1
  ) {
    if (hasLikelyApplicationSurface(site, collectors)) {
      if (site === "greenhouse") {
        revealLikelyApplicationRegion(site, attempt, collectors);
      }
      return true;
    }

    if (
      site !== "monster" &&
      getApplicationSurfaceScrollAttempts(site).has(attempt)
    ) {
      revealLikelyApplicationRegion(site, attempt, collectors);
    }

    await sleep(APPLICATION_SURFACE_WAIT_DELAYS_MS[attempt]);
  }

  return false;
}

function getApplicationSurfaceScrollAttempts(site: SiteKey): Set<number> {
  return site === "greenhouse"
    ? GREENHOUSE_APPLICATION_SURFACE_SCROLL_ATTEMPTS
    : APPLICATION_SURFACE_SCROLL_ATTEMPTS;
}

function revealLikelyApplicationRegion(
  site: SiteKey,
  attempt: number,
  collectors: ApplicationSurfaceCollectors
): void {
  if (scrollLikelyApplicationAnchorIntoView(site, collectors)) {
    return;
  }

  const totalHeight = Math.max(
    document.body?.scrollHeight ?? 0,
    document.documentElement?.scrollHeight ?? 0
  );
  const viewportHeight = Math.max(window.innerHeight, 1);
  const maxScrollTop = Math.max(0, totalHeight - viewportHeight);

  if (maxScrollTop <= 0) {
    return;
  }

  const waypoints =
    site === "greenhouse"
      ? [0.38, 0.66, 0.86, 1]
      : [0.25, 0.5, 0.78, 1];
  const waypointIndex =
    attempt <= 1
      ? 0
      : attempt <= 4
        ? 1
        : attempt <= 8
          ? 2
          : attempt <= 12
            ? Math.min(3, waypoints.length - 1)
            : waypoints.length - 1;
  const targetTop = Math.round(maxScrollTop * waypoints[waypointIndex]);

  window.scrollTo({
    top: targetTop,
    behavior: "auto",
  });
}

function scrollLikelyApplicationAnchorIntoView(
  site: SiteKey,
  collectors: ApplicationSurfaceCollectors
): boolean {
  const hashTarget = decodeHashTarget(window.location.hash);
  const candidateIds = [
    hashTarget,
    "application",
    "apply",
    "job-application",
    "job_application",
  ].filter(Boolean) as string[];

  for (const id of candidateIds) {
    const target = document.getElementById(id);
    if (!target) {
      continue;
    }

    if (scrollElementNearTop(target)) {
      return true;
    }
  }

  const revealTarget = findLikelyApplicationRevealTarget(site, collectors);
  if (revealTarget) {
    return scrollElementNearTop(revealTarget);
  }

  return false;
}

function findLikelyApplicationRevealTarget(
  site: SiteKey,
  collectors: ApplicationSurfaceCollectors
): HTMLElement | null {
  const candidates: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();
  const pushCandidate = (element: HTMLElement | null | undefined) => {
    if (!element || seen.has(element) || !isRevealableElement(element)) {
      return;
    }

    seen.add(element);
    candidates.push(element);
  };

  for (const field of collectors.collectAutofillFields()) {
    if (!isRevealableApplicationField(field)) {
      continue;
    }

    pushCandidate(getApplicationRevealContainer(field));
    pushCandidate(field);
  }

  for (const input of collectors.collectResumeFileInputs()) {
    if (!isRevealableElement(input)) {
      continue;
    }

    pushCandidate(getApplicationRevealContainer(input));
    pushCandidate(input);
  }

  if (site === "greenhouse") {
    for (const shell of collectDeepMatches<HTMLElement>(
      GREENHOUSE_LAUNCH_SHELL_SELECTOR
    )) {
      if (isLikelyGreenhouseRevealSurface(shell)) {
        pushCandidate(shell);
      }
    }
  }

  let best: { element: HTMLElement; top: number; priority: number } | null = null;
  const currentScrollTop =
    window.scrollY ||
    window.pageYOffset ||
    document.documentElement?.scrollTop ||
    document.body?.scrollTop ||
    0;

  for (const candidate of candidates) {
    const rect = candidate.getBoundingClientRect();
    const documentTop = currentScrollTop + rect.top;
    const priority = getRevealTargetPriority(candidate);

    if (
      !best ||
      documentTop < best.top - 1 ||
      (Math.abs(documentTop - best.top) <= 1 && priority < best.priority)
    ) {
      best = {
        element: candidate,
        top: documentTop,
        priority,
      };
    }
  }

  return best?.element ?? null;
}

function isLikelyGreenhouseRevealSurface(element: HTMLElement): boolean {
  if (!isRevealableElement(element)) {
    return false;
  }

  const text = cleanText(element.innerText || element.textContent || "")
    .toLowerCase()
    .slice(0, 1500);
  const metadata = cleanText(
    [
      element.id,
      typeof element.className === "string" ? element.className : "",
      element.getAttribute("data-testid"),
      element.getAttribute("data-test"),
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.getAttribute("role"),
    ]
      .filter(Boolean)
      .join(" ")
  ).toLowerCase();

  if (!text && !metadata) {
    return false;
  }

  return [
    "autofill with resume",
    "auto fill with resume",
    "apply manually",
    "use my last application",
    "continue application",
    "submit application",
    "upload resume",
    "upload cv",
    "powered by greenhouse",
    "greenhouse",
    "application",
    "resume",
  ].some((signal) => text.includes(signal) || metadata.includes(signal));
}

function getApplicationRevealContainer(element: HTMLElement): HTMLElement | null {
  return element.closest(
    "form, [role='form'], fieldset, [id*='application' i], [id*='apply' i], [class*='application' i], [class*='apply' i], [data-testid*='application' i], [data-testid*='apply' i]"
  );
}

function getRevealTargetPriority(element: HTMLElement): number {
  if (
    element.matches(
      "form, [role='form'], fieldset, [id*='application' i], [class*='application' i]"
    )
  ) {
    return 0;
  }

  if (element.matches("input[type='file'], input, textarea, select")) {
    return 1;
  }

  return 2;
}

function isRevealableApplicationField(field: AutofillField): boolean {
  if (!field.isConnected || field.disabled || !isRevealableElement(field)) {
    return false;
  }

  if (field instanceof HTMLInputElement) {
    const type = field.type.toLowerCase();
    if (["hidden", "submit", "button", "reset", "image"].includes(type)) {
      return false;
    }
  }

  return isLikelyApplicationField(field);
}

function isRevealableElement(element: HTMLElement): boolean {
  if (!element.isConnected) {
    return false;
  }

  let current: HTMLElement | null = element;
  while (current) {
    const styles = window.getComputedStyle(current);
    const opacity = Number.parseFloat(styles.opacity);
    if (
      styles.visibility === "hidden" ||
      styles.visibility === "collapse" ||
      styles.display === "none" ||
      (Number.isFinite(opacity) && opacity <= 0.01)
    ) {
      return false;
    }
    current = current.parentElement;
  }

  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function scrollElementNearTop(target: HTMLElement): boolean {
  try {
    const rect = target.getBoundingClientRect();
    const currentScrollTop =
      window.scrollY ||
      window.pageYOffset ||
      document.documentElement?.scrollTop ||
      document.body?.scrollTop ||
      0;
    const topPadding = Math.max(96, Math.round(window.innerHeight * 0.14));
    const targetTop = Math.max(
      0,
      Math.round(currentScrollTop + rect.top - topPadding)
    );

    window.scrollTo({
      top: targetTop,
      behavior: "auto",
    });
    return true;
  } catch {
    return false;
  }
}

function decodeHashTarget(hash: string): string {
  const trimmed = hash.trim().replace(/^#/, "");
  if (!trimmed) {
    return "";
  }

  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}

export function hasLikelyApplicationForm(
  collectors: ApplicationSurfaceCollectors
): boolean {
  const relevantFields = collectors.collectAutofillFields().filter(
    (field) => shouldAutofillField(field, true, true) && isLikelyApplicationField(field)
  );

  if (relevantFields.length >= 2) {
    return true;
  }

  return collectors.collectResumeFileInputs().some(
    (input) => shouldAutofillField(input, true, true) && isLikelyApplicationField(input)
  );
}

export function hasLikelyApplicationFrame(): boolean {
  return collectLikelyApplicationFrames().length > 0;
}

export function findStandaloneApplicationFrameUrl(
  collectors: ApplicationSurfaceCollectors
): string | null {
  const localRelevantFields = collectors.collectAutofillFields().filter(
    (field) => shouldAutofillField(field, true, true) && isLikelyApplicationField(field)
  );

  if (localRelevantFields.length > 0) {
    return null;
  }

  const hasLocalResumeUpload = collectors.collectResumeFileInputs().some(
    (input) => shouldAutofillField(input, true, true) && isLikelyApplicationField(input)
  );

  if (hasLocalResumeUpload) {
    return null;
  }

  let best:
    | {
        score: number;
        url: string;
      }
    | undefined;

  for (const frame of collectLikelyApplicationFrames()) {
    if (!best || frame.score > best.score) {
      best = {
        score: frame.score,
        url: frame.url,
      };
    }
  }

  return best?.url ?? null;
}

function collectLikelyApplicationFrames(): Array<{
  frame: HTMLIFrameElement;
  score: number;
  url: string;
}> {
  const frames: Array<{
    frame: HTMLIFrameElement;
    score: number;
    url: string;
  }> = [];

  for (const frame of Array.from(
    document.querySelectorAll<HTMLIFrameElement>(APPLICATION_FRAME_SELECTOR)
  )) {
    if (!isElementVisible(frame)) {
      continue;
    }

    const rawUrl = frame.getAttribute("src") || frame.getAttribute("data-src") || "";
    const url = normalizeUrl(rawUrl);

    if (!url) {
      continue;
    }

    const lower = url.toLowerCase();
    const frameSignals = [
      frame.id,
      frame.className,
      frame.getAttribute("title"),
      frame.getAttribute("aria-label"),
    ]
      .join(" ")
      .toLowerCase();

    let score = 0;

    if (lower.includes("greenhouse.io")) score += 120;
    if (lower.includes("lever.co")) score += 110;
    if (lower.includes("workdayjobs.com") || lower.includes("myworkdayjobs.com")) {
      score += 110;
    }
    if (lower.includes("apply")) score += 40;
    if (lower.includes("application")) score += 35;
    if (lower.includes("candidate")) score += 30;
    if (frameSignals.includes("apply")) score += 20;
    if (frameSignals.includes("application")) score += 18;
    if (frameSignals.includes("resume")) score += 12;

    if (score <= 0) {
      continue;
    }

    frames.push({
      frame,
      score,
      url,
    });
  }

  return frames;
}

export function hasLikelyApplicationSurface(
  site: SiteKey,
  collectors: ApplicationSurfaceCollectors
): boolean {
  if (site === "indeed" && hasIndeedApplyIframe()) {
    return true;
  }

  if (site === "ziprecruiter" && hasZipRecruiterApplyModal()) {
    return true;
  }

  if (site === "monster" && hasMonsterInlineApplySurface(collectors)) {
    return true;
  }

  if (site === "greenhouse" && hasLikelyGreenhouseLaunchSurface()) {
    return true;
  }

  if (
    (site === "builtin" || site === "other_sites" || site === "startup") &&
    hasLikelyAtsLaunchModalSurface()
  ) {
    return true;
  }

  const onApplyLikeUrl = isAlreadyOnApplyPage(site, window.location.href);
  const hasPageContent = hasLikelyApplicationPageContent();
  const hasProgression = Boolean(findProgressionAction(site));
  const hasCompanySiteStep = Boolean(findCompanySiteAction());
  const stillLooksLikeJobPage = Boolean(findApplyAction(site, "job-page"));

  return (
    hasLikelyApplicationForm(collectors) ||
    hasLikelyApplicationFrame() ||
    (onApplyLikeUrl && (hasPageContent || hasProgression || hasCompanySiteStep)) ||
    (hasPageContent &&
      (hasProgression || hasCompanySiteStep) &&
      !stillLooksLikeJobPage) ||
    (onApplyLikeUrl && hasPageContent)
  );
}

function hasMonsterInlineApplySurface(
  collectors: ApplicationSurfaceCollectors
): boolean {
  const relevantFields = collectors.collectAutofillFields().filter(
    (field) => shouldAutofillField(field, true, true) && isLikelyApplicationField(field)
  );
  const relevantResumeInputs = collectors.collectResumeFileInputs().filter(
    (input) => shouldAutofillField(input, true, true) && isLikelyApplicationField(input)
  );
  const progression = findProgressionAction("monster");
  const progressionElement =
    progression?.type === "click" ? progression.element : null;

  for (const shell of collectDeepMatches<HTMLElement>(
    MONSTER_APPLICATION_SHELL_SELECTOR
  )) {
    if (!isElementVisible(shell)) {
      continue;
    }

    const text = cleanText(shell.innerText || shell.textContent || "")
      .toLowerCase()
      .slice(0, 2000);
    if (!text) {
      continue;
    }

    const metadata = cleanText(
      [
        shell.id,
        typeof shell.className === "string" ? shell.className : "",
        shell.getAttribute("data-testid"),
        shell.getAttribute("data-test"),
        shell.getAttribute("aria-label"),
        shell.getAttribute("title"),
        shell.getAttribute("role"),
      ]
        .filter(Boolean)
        .join(" ")
    ).toLowerCase();
    const signalCount = [
      "apply",
      "application",
      "resume",
      "upload",
      "continue",
      "next",
      "start",
      "candidate",
      "email",
      "phone",
      "password",
      "account",
      "work authorization",
      "cover letter",
    ].filter((token) => text.includes(token) || metadata.includes(token)).length;
    const modalLike =
      shell.matches("[role='dialog'], [aria-modal='true']") ||
      /\b(modal|drawer|overlay|sheet|popup)\b/.test(metadata);
    const applyLike = /\b(apply|application|candidate|resume|upload)\b/.test(
      metadata
    );
    const shellFieldCount = relevantFields.filter((field) =>
      shell.contains(field)
    ).length;
    const hasResumeUpload = relevantResumeInputs.some((input) =>
      shell.contains(input)
    );
    const hasAccountField = Boolean(
      shell.querySelector(
        "input[type='email'], input[type='tel'], input[type='password']"
      )
    );
    const hasActionControl = Boolean(
      shell.querySelector(
        "button, a[href], [role='button'], input[type='submit'], input[type='button']"
      )
    );
    const hasProgressionControl = Boolean(
      progressionElement &&
        progressionElement !== shell &&
        shell.contains(progressionElement)
    );

    if (shellFieldCount >= 1 || hasResumeUpload) {
      return true;
    }

    if (
      hasProgressionControl &&
      (modalLike || applyLike || signalCount >= 2)
    ) {
      return true;
    }

    if (
      modalLike &&
      hasActionControl &&
      signalCount >= 2 &&
      (hasAccountField || text.includes("resume") || text.includes("apply"))
    ) {
      return true;
    }

    if (applyLike && hasActionControl && hasAccountField && signalCount >= 3) {
      return true;
    }
  }

  return false;
}

function hasLikelyGreenhouseLaunchSurface(): boolean {
  for (const shell of collectDeepMatches<HTMLElement>(
    GREENHOUSE_LAUNCH_SHELL_SELECTOR
  )) {
    if (!isElementVisible(shell)) {
      continue;
    }

    const text = cleanText(shell.innerText || shell.textContent || "")
      .toLowerCase()
      .slice(0, 2000);
    if (!text) {
      continue;
    }

    const metadata = cleanText(
      [
        shell.id,
        typeof shell.className === "string" ? shell.className : "",
        shell.getAttribute("data-testid"),
        shell.getAttribute("data-test"),
        shell.getAttribute("aria-label"),
        shell.getAttribute("title"),
        shell.getAttribute("role"),
      ]
        .filter(Boolean)
        .join(" ")
    ).toLowerCase();
    const modalLike =
      shell.matches("[role='dialog'], [aria-modal='true']") ||
      /\b(modal|drawer|overlay|sheet|popup)\b/.test(metadata);
    const hasLaunchMetadata = /\b(apply|application|candidate|resume|greenhouse)\b/.test(
      metadata
    );
    const actionCount = shell.querySelectorAll(
      "button, a[href], [role='button'], input[type='submit'], input[type='button']"
    ).length;
    const hasResumeUpload = Boolean(
      shell.querySelector(
        "input[type='file'], input[name*='resume' i], input[id*='resume' i], input[aria-label*='resume' i]"
      )
    );
    const hasIdentityField = Boolean(
      shell.querySelector(
        "input[type='email'], input[type='tel'], input[name*='first' i], input[name*='last' i], textarea"
      )
    );
    const hasGreenhouseFrame = Boolean(
      shell.querySelector(
        "iframe[src*='greenhouse.io'], iframe[data-src*='greenhouse.io']"
      )
    );
    const hasProgressionControl = Array.from(
      shell.querySelectorAll<HTMLElement>(
        "button, a[href], [role='button'], input[type='submit'], input[type='button']"
      )
    ).some((control) => {
      if (!isElementVisible(control)) {
        return false;
      }

      const controlText = cleanText(
        [
          control.innerText,
          control.textContent,
          control.getAttribute("aria-label"),
          control.getAttribute("title"),
          control.getAttribute("value"),
          control.getAttribute("data-testid"),
          control.getAttribute("data-test"),
        ]
          .filter(Boolean)
          .join(" ")
      ).toLowerCase();

      return (
        /\bcontinue\b/.test(controlText) ||
        /\bnext\b/.test(controlText) ||
        /\breview\b/.test(controlText) ||
        /\bsubmit(?:\s+your)?\s+application\b/.test(controlText) ||
        /\bconfirm\s+and\s+submit\b/.test(controlText) ||
        /\bsend\s+application\b/.test(controlText) ||
        /\bautofill with resume\b/.test(controlText) ||
        /\bauto[- ]?fill with resume\b/.test(controlText) ||
        /\bapply manually\b/.test(controlText) ||
        /\buse my last application\b/.test(controlText) ||
        /\bstart (?:my |your )?application\b/.test(controlText) ||
        /\bcontinue application\b/.test(controlText)
      );
    });
    const signalCount = [
      "apply for this job",
      "start application",
      "continue application",
      "submit application",
      "powered by greenhouse",
      "upload resume",
      "upload cv",
      "cover letter",
      "autofill",
      "candidate",
      "resume",
      "application",
      "greenhouse",
    ].filter((signal) => text.includes(signal) || metadata.includes(signal)).length;

    if (!modalLike && !hasLaunchMetadata && signalCount < 3) {
      continue;
    }

    if (hasGreenhouseFrame) {
      return true;
    }

    if (hasResumeUpload && hasIdentityField) {
      return true;
    }

    if (
      hasProgressionControl &&
      (signalCount >= 3 || hasResumeUpload || hasIdentityField || modalLike)
    ) {
      return true;
    }

    if (signalCount >= 4 && actionCount >= 1 && (hasResumeUpload || modalLike)) {
      return true;
    }
  }

  return false;
}

function hasLikelyAtsLaunchModalSurface(): boolean {
  for (const shell of collectDeepMatches<HTMLElement>(
    "[role='dialog'], [aria-modal='true'], [class*='modal'], [class*='drawer'], [class*='overlay'], [class*='sheet'], [class*='popup']"
  )) {
    if (!isElementVisible(shell)) {
      continue;
    }

    const text = cleanText(shell.innerText || shell.textContent || "")
      .toLowerCase()
      .slice(0, 2000);
    if (!text) {
      continue;
    }

    const actionCount = shell.querySelectorAll(
      "button, a[href], [role='button'], input[type='submit'], input[type='button']"
    ).length;
    if (actionCount < 2) {
      continue;
    }

    const signalCount = [
      "start your application",
      "start application",
      "start my application",
      "autofill with resume",
      "apply manually",
      "use my last application",
      "resume",
      "application",
    ].filter((signal) => text.includes(signal)).length;

    if (signalCount >= 3) {
      return true;
    }
  }

  return false;
}

export function isLikelyApplicationField(field: AutofillField): boolean {
  const question = getQuestionText(field);
  const descriptor = getFieldDescriptor(field, question);
  if (!descriptor) {
    return false;
  }

  if (
    matchesDescriptor(descriptor, [
      "job title",
      "keywords",
      "search jobs",
      "search for jobs",
      "find jobs",
      "job search",
      "search by keyword",
      "enter location",
      "search location",
      "filter",
      "sort by",
    ])
  ) {
    return false;
  }

  if (
    descriptor === "what" ||
    descriptor === "where" ||
    descriptor === "search" ||
    descriptor === "q"
  ) {
    return false;
  }

  if (field instanceof HTMLInputElement) {
    const type = field.type.toLowerCase();
    if (type === "search") {
      return false;
    }

    if (type === "file") {
      return matchesDescriptor(descriptor, [
        "resume",
        "cv",
        "cover letter",
        "attachment",
        "upload",
        "document",
      ]);
    }
  }

  const fieldAutocomplete = (field.getAttribute("autocomplete") || "")
    .toLowerCase()
    .trim();
  if (
    [
      "name",
      "given-name",
      "additional-name",
      "family-name",
      "email",
      "tel",
      "street-address",
      "address-line1",
      "address-line2",
      "address-level1",
      "address-level2",
      "postal-code",
      "country",
      "organization",
      "organization-title",
      "url",
    ].includes(fieldAutocomplete)
  ) {
    return true;
  }

  if (
    matchesDescriptor(descriptor, [
      "full name",
      "first name",
      "last name",
      "given name",
      "family name",
      "surname",
      "your name",
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
      "town",
      "address",
      "state",
      "province",
      "region",
      "country",
      "postal code",
      "zip code",
      "current company",
      "current employer",
      "employer",
      "experience",
      "years of experience",
      "year of experience",
      "total experience",
      "overall experience",
      "salary",
      "work authorization",
      "authorized to work",
      "eligible to work",
      "legally authorized",
      "authorized",
      "sponsorship",
      "visa",
      "relocate",
      "relocation",
      "cover letter",
      "resume",
      "cv",
      "education",
      "school",
      "degree",
      "start date",
      "available to start",
      "notice period",
    ])
  ) {
    return true;
  }

  const container = field.closest(
    "form, fieldset, [role='dialog'], article, section, main, aside, div"
  );
  const containerText = normalizeChoiceText(
    cleanText(container?.textContent).slice(0, 600)
  );
  if (!containerText) {
    return false;
  }

  if (
    [
      "job title",
      "keywords",
      "search jobs",
      "find jobs",
      "company reviews",
      "find salaries",
      "post a job",
    ].some((term) => containerText.includes(normalizeChoiceText(term)))
  ) {
    return false;
  }

  return [
    "application",
    "apply",
    "candidate",
    "resume",
    "cv",
    "cover letter",
    "work authorization",
    "experience",
    "employment",
    "education",
    "equal opportunity",
    "demographic",
  ].some((term) => containerText.includes(normalizeChoiceText(term)));
}

export function hasLikelyApplicationPageContent(): boolean {
  const bodyText = cleanText(
    document.body?.innerText || document.body?.textContent || ""
  )
    .toLowerCase()
    .slice(0, 5000);
  if (!bodyText) {
    return false;
  }

  const strongSignals = [
    "upload resume",
    "upload your resume",
    "upload cv",
    "attach resume",
    "attach your resume",
    "submit application",
    "apply for this",
    "application form",
    "submit your application",
    "start my application",
    "you re on your way to apply",
    "please review your application",
    "review your application",
    "review before submitting",
  ];

  if (strongSignals.some((token) => bodyText.includes(token))) {
    return true;
  }

  const weakSignals = [
    "application",
    "resume",
    "cover letter",
    "work authorization",
    "years of experience",
    "phone number",
    "email address",
    "linkedin",
    "portfolio",
    "salary",
    "start date",
    "notice period",
  ];

  const matchCount = weakSignals.filter((token) => bodyText.includes(token)).length;
  return matchCount >= 3;
}
