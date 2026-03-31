// Apply-action discovery for job boards and external career sites.

import { SiteKey } from "../shared";
import { ApplyAction, ProgressionAction } from "./types";
import { cleanText } from "./text";
import {
  collectDeepMatches,
  collectDeepMatchesForSelectors,
  collectShadowHosts,
  getActionText,
  getClickableApplyElement,
  getNavigationUrl,
  isElementVisible,
  isExternalUrl,
  normalizeUrl,
} from "./dom";
import {
  ATS_APPLICATION_URL_TOKENS,
  ATS_SCORING_URL_TOKENS,
  KNOWN_ATS_HOST_TOKENS,
  includesAnyToken,
} from "./sitePatterns";
import {
  getDiceNestedResultSelectors,
  getPrimaryCurrentJobSurfaceSelectors,
  getSiteApplyCandidateSelectors,
} from "./sites";

const COMPANY_SITE_GATE_TOKENS = [
  "company website to apply",
  "company site to apply",
  "continue to the company",
  "continue to company site",
  "continue to company website",
  "continue to employer site",
  "employer website",
  "apply on company site",
  "apply on company website",
  "apply on employer",
  "apply externally",
  "external application",
  "apply on the company",
  "visit company site",
  "visit employer site",
  "redirected to the company",
  "redirected to an external",
  "taken to the employer",
  "taken to the company",
  "company's website",
  "employer's website",
  "company career",
  "employer career",
  "apply on company's site",
  "apply on the employer",
  "apply at company",
  "apply at employer",
  "go to company site",
  "go to employer site",
  "view on company site",
  "apply directly",
  "direct application",
  "original posting",
  "original job posting",
  // Keep site-specific CTA wording close to the shared token list.
  "apply on external site",
  "apply on their site",
  "apply on their website",
  "view original posting",
  "view original job",
  "external job",
  "external link",
  "view application",
  "apply through",
];

const KNOWN_BROKEN_APPLY_HOSTS = ["apply.monster.com"];
const MAX_APPLY_URL_SOURCE_COUNT = 40;
const MAX_APPLY_URL_SOURCE_LENGTH = 60_000;
const MAX_APPLY_URL_MARKUP_LENGTH = 180_000;
const MAX_APPLY_URL_MARKUP_SNIPPET_COUNT = 6;
const APPLY_URL_MARKUP_SNIPPET_LENGTH = Math.floor(
  MAX_APPLY_URL_MARKUP_LENGTH / MAX_APPLY_URL_MARKUP_SNIPPET_COUNT
);
const NON_ACTION_TECH_LABEL_PATTERN =
  /^(?:next\.?js|react(?:\.js)?|node\.?js|vue(?:\.js)?|nuxt\.?js|nestjs|typescript|javascript|python|java|golang|go|aws|gcp|azure|docker|kubernetes|graphql|tailwind(?:css)?|postgres(?:ql)?|mysql|mongodb)$/i;
const NON_ACTION_TECH_URL_PATTERN =
  /(?:nextjs\.org|react(?:js)?\.(?:org|dev)|nodejs\.org|vuejs\.org|angular\.dev|typescriptlang\.org|python\.org|golang\.org|go\.dev|tailwindcss\.com|npmjs\.com|docs?\.)/i;
const APPLY_URL_DISCOVERY_TOKENS = [
  "apply",
  "application",
  "candidate",
  "career",
  "greenhouse",
  "lever",
  "ashby",
  "workday",
  "job",
];
const MONSTER_DETAIL_BOUNDARY_PATTERNS = [
  /^profile insights$/,
  /^description$/,
  /^job description$/,
  /^job details$/,
  /^job details and requirements$/,
  /^about (?:the )?(?:job|role|position)$/,
  /^about this (?:job|role|position)$/,
  /^role overview$/,
  /^responsibilities$/,
  /^qualifications$/,
  /^what (?:you'll|you will) do$/,
];
const MIN_MONSTER_TITLE_REGION_GAP_BELOW = 220;
const MAX_MONSTER_TITLE_REGION_GAP_BELOW = 360;
const MIN_MONSTER_TITLE_REGION_GAP_ABOVE = 80;
const MAX_MONSTER_TITLE_REGION_GAP_ABOVE = 140;
const MONSTER_TITLE_REGION_BELOW_MULTIPLIER = 4;
const MONSTER_TITLE_REGION_ABOVE_MULTIPLIER = 1.5;
const MONSTER_TITLE_REGION_HORIZONTAL_ALLOWANCE = 520;
const ZIP_RECRUITER_DIALOG_SELECTOR =
  "[role='dialog'], [aria-modal='true'], [class*='modal'], [class*='overlay'], [class*='popup'], [data-testid*='modal'], [data-testid*='apply']";
const ZIP_RECRUITER_ACTIVE_MODAL_TEXT_TOKENS = [
  "apply",
  "application",
  "resume",
  "upload",
  "experience",
  "education",
  "work authorization",
  "cover letter",
];
const ZIP_RECRUITER_APPLIED_STATE_PATTERNS = [
  /^\s*applied\s*$/i,
  /\balready applied\b/i,
  /\byou already applied\b/i,
  /\byou(?:'ve| have)? applied\b/i,
  /\byou(?:'ve| have)? successfully applied\b/i,
  /\balready submitted\b/i,
  /\bapplication submitted\b/i,
  /\bapplication complete\b/i,
  /\bapplication received\b/i,
  /\bthank(?:s| you) for applying\b/i,
  /\byour application (?:has been|was) submitted\b/i,
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isLegalOrPolicyText(text: string): boolean {
  const lower = text.toLowerCase();
  if (!lower) {
    return false;
  }

  if (
    [
      "terms of service",
      "terms and conditions",
      "privacy policy",
      "cookie policy",
      "legal notice",
      "cookie & privacy policies",
      "terms, cookie & privacy policies",
    ].some((token) => lower.includes(token))
  ) {
    return true;
  }

  const legalSignals = ["terms", "privacy", "cookie", "legal"];
  return legalSignals.filter((token) => lower.includes(token)).length >= 2;
}

function collectDeepMatchesFromSelectors(
  selectors: string[]
): HTMLElement[] {
  return collectDeepMatchesForSelectors<HTMLElement>(selectors);
}

function isKnownBrokenApplyUrl(url: string | null | undefined): boolean {
  if (!url) {
    return false;
  }

  try {
    const parsed = new URL(url, window.location.href);
    const hostname = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();

    if (KNOWN_BROKEN_APPLY_HOSTS.includes(hostname)) {
      return true;
    }

    if (
      hostname.includes("indeed.com") &&
      (path.includes("/orgindapp") || path.includes("/conv/orgindapp"))
    ) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

function isLikelyInformationalPageUrl(url: string | null | undefined): boolean {
  if (!url) {
    return false;
  }

  const lower = url.toLowerCase();
  if (
    ["/404", "not-found", "page-not-found", "/unavailable", "/error"].some(
      (token) => lower.includes(token)
    )
  ) {
    return true;
  }

  const hasApplyCue =
    /apply|application|candidate|jobapply|zipapply|indeedapply|easyapply|career|careers|opening|openings|position|positions|jobs?\//.test(
      lower
    ) || includesAnyToken(lower, ATS_APPLICATION_URL_TOKENS);

  if (hasApplyCue) {
    return false;
  }

  return [
    "support.",
    "/support",
    "/help",
    "/hc/",
    "/articles/",
    "/faq",
    "/faqs",
    "/knowledge",
    "/guide",
    "/guides",
    "/blog",
    "/privacy",
    "/terms",
    "/cookie",
    "/legal",
    "/about",
    "/contact",
  ].some((token) => lower.includes(token));
}

function isZipRecruiterCandidatePortalUrl(url: string | null | undefined): boolean {
  if (!url) {
    return false;
  }

  try {
    const parsed = new URL(url, window.location.href);
    const hostname = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();

    if (!hostname.includes("ziprecruiter")) {
      return false;
    }

    if (path.includes("candidateexperience") || path.includes("jobapply")) {
      return false;
    }

    return (
      path.includes("/candidate/") ||
      path.includes("/my-jobs") ||
      path.includes("/myjobs") ||
      path.includes("/saved-jobs") ||
      path.includes("/savedjobs") ||
      path.includes("/profile") ||
      path.includes("/account") ||
      path.includes("/login") ||
      path.includes("/signin")
    );
  } catch {
    return false;
  }
}

export function findCompanySiteAction(): ApplyAction | null {
  const pageText = cleanText(document.body?.innerText || "")
    .toLowerCase()
    .slice(0, 6000);
  const hasGateText = COMPANY_SITE_GATE_TOKENS.some((token) => pageText.includes(token));
  const candidates = collectDeepMatchesFromSelectors([
    "a[href]",
    "button",
    "input[type='submit']",
    "input[type='button']",
    "[role='button']",
  ]);

  let best:
    | {
        element: HTMLElement;
        score: number;
        text: string;
        url: string | null;
      }
    | undefined;

  for (const element of candidates) {
    const actionElement = getClickableApplyElement(element);
    if (
      !isElementVisible(actionElement) ||
      actionElement.hasAttribute("disabled") ||
      (actionElement as HTMLButtonElement).disabled
    ) {
      continue;
    }

    const text = cleanText(
      getActionText(actionElement) ||
        getActionText(element) ||
        actionElement.getAttribute("aria-label") ||
        actionElement.getAttribute("title") ||
        element.getAttribute("aria-label") ||
        element.getAttribute("title") ||
        ""
    );
    const lower = text.toLowerCase();
    const url = getNavigationUrl(actionElement) ?? getNavigationUrl(element);
    const attrs = [
      actionElement.getAttribute("data-test"),
      actionElement.getAttribute("data-testid"),
      actionElement.getAttribute("data-tn-element"),
      actionElement.getAttribute("aria-label"),
      actionElement.getAttribute("title"),
      actionElement.className,
      actionElement.id,
      element.getAttribute("data-testid"),
      element.getAttribute("data-tn-element"),
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.className,
      element.id,
      element.getAttribute("data-test"),
    ]
      .join(" ")
      .toLowerCase();

    if (
      [
        "save",
        "share",
        "report",
        "sign in",
        "sign up",
        "dismiss",
        "close",
        "back to search",
        "back to results",
        "log in",
        "register",
        "create account",
        "job alert",
        "subscribe",
      ].some((blocked) => lower.includes(blocked)) ||
      isLegalOrPolicyText(lower)
    ) {
      continue;
    }

    if (isLikelyTechnologyReferenceAction(text, url)) {
      continue;
    }

    if (isLikelyInformationalPageUrl(url)) {
      continue;
    }

    if (isLikelyNavigationChrome(actionElement) && !hasGateText && !url) {
      continue;
    }

    let score = 0;

    if (
      lower.includes("continue to company site") ||
      lower.includes("continue to company website")
    ) {
      score += 110;
    } else if (
      lower.includes("apply on company") ||
      lower.includes("apply on employer")
    ) {
      score += 105;
    } else if (lower.includes("apply externally") || lower.includes("apply directly")) {
      score += 102;
    } else if (lower.includes("apply on external") || lower.includes("apply through")) {
      score += 100;
    } else if (
      lower.includes("company site") ||
      lower.includes("company website")
    ) {
      score += 96;
    } else if (
      lower.includes("visit company") ||
      lower.includes("visit employer") ||
      lower.includes("go to company") ||
      lower.includes("go to employer")
    ) {
      score += 90;
    } else if (lower.includes("external application") || lower.includes("direct application")) {
      score += 85;
    } else if (lower.includes("view original") || lower.includes("original posting")) {
      score += 82;
    } else if (
      lower.includes("apply now") ||
      lower.includes("apply for this") ||
      lower.includes("continue")
    ) {
      score += 62;
    } else if (lower.includes("visit") && lower.includes("site")) {
      score += 72;
    } else if (lower.includes("apply")) {
      score += 55;
    }

    if (attrs.includes("company") || attrs.includes("employer")) {
      score += 20;
    }
    if (attrs.includes("external") || attrs.includes("apply")) {
      score += 12;
    }
    if (url && isExternalUrl(url)) {
      score += 28;
    }
    if (url && shouldPreferApplyNavigation(url, text, null)) {
      score += 20;
    }
    if (hasGateText) {
      score += 18;
    }
    if (isLikelyApplicationContext(actionElement)) {
      score += 18;
    } else if (isLikelyNavigationChrome(actionElement)) {
      score -= 28;
    }

    // Company-site CTAs are often shorter and less explicit than direct apply CTAs.
    const threshold = hasGateText ? 35 : 70;
    if (score < threshold) {
      continue;
    }

    if (!best || score > best.score) {
      best = { element: actionElement, score, text, url };
    }
  }

  if (!best) {
    return null;
  }

  const explicitCompanySiteAction = isCompanySiteActionText(best.text);
  if (
    best.url &&
    !isKnownBrokenApplyUrl(best.url) &&
    (isExternalUrl(best.url) ||
      (!explicitCompanySiteAction &&
        shouldPreferApplyNavigation(best.url, best.text, null)))
  ) {
    return {
      type: "navigate",
      url: best.url,
      description: describeApplyTarget(best.url, best.text),
    };
  }

  const extractedUrl =
    extractLikelyApplyUrl(best.element) ??
    findExternalApplyUrlInDocument();
  if (extractedUrl) {
    return {
      type: "navigate",
      url: extractedUrl,
      description: describeApplyTarget(extractedUrl, best.text),
    };
  }

  return {
    type: "click",
    element: best.element,
    description: best.text || "the company career page",
  };
}

type ScoredApplyCandidate = {
  element: HTMLElement;
  score: number;
  text: string;
  url: string | null;
  fallbackElements?: HTMLElement[];
};

function isCompanySiteActionText(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("company site") ||
    lower.includes("company website") ||
    lower.includes("employer site") ||
    lower.includes("employer website") ||
    lower.includes("continue to company") ||
    lower.includes("continue to employer") ||
    lower.includes("visit company") ||
    lower.includes("visit employer") ||
    lower.includes("go to company") ||
    lower.includes("go to employer") ||
    lower.includes("apply on company") ||
    lower.includes("apply on employer") ||
    lower.includes("apply externally") ||
    lower.includes("apply directly") ||
    lower.includes("apply on external") ||
    lower.includes("apply through")
  );
}

function isZipRecruiterExplicitCompanyApplyControl(
  text: string,
  attrs: string,
  url: string | null
): boolean {
  const lower = text.toLowerCase();
  const lowerUrl = url?.toLowerCase() ?? "";

  if (isCompanySiteActionText(lower)) {
    return true;
  }

  return [
    "company-apply",
    "companyapply",
    "company-site",
    "employer-site",
    "external-apply",
    "externalapply",
  ].some((token) => attrs.includes(token)) ||
    (lower.includes("continue") && lower.includes("company")) ||
    (lower.includes("apply") && lower.includes("company")) ||
    (typeof url === "string" &&
      isExternalUrl(url) &&
      /careers?\/apply|\/apply\/|candidateexperience|jobapply|zipapply/.test(
        lowerUrl
      ));
}

function isTapApplyActionText(text: string): boolean {
  const lower = text.toLowerCase().trim();
  if (!lower) {
    return false;
  }

  return (
    /(?:^|\b)(?:1|one)[\s-]?tap apply\b/.test(lower) ||
    /\btap to apply\b/.test(lower)
  );
}

function isDirectApplyActionCandidate(text: string, url: string | null): boolean {
  const lower = text.toLowerCase().trim();
  if (!lower || isCompanySiteActionText(lower)) {
    return false;
  }

  if (
    lower === "apply now" ||
    lower === "apply" ||
    lower === "easy apply" ||
    lower === "quick apply" ||
    lower === "indeed apply" ||
    lower === "1-click apply" ||
    lower === "1 click apply" ||
    isTapApplyActionText(lower) ||
    lower.includes("start application") ||
    lower.includes("begin application") ||
    lower.includes("apply for this") ||
    lower.includes("apply to this") ||
    lower.includes("continue application")
  ) {
    return true;
  }

  const lowerUrl = url?.toLowerCase() ?? "";
  return (
    Boolean(lowerUrl) &&
    !isExternalUrl(url || "") &&
    /smartapply\.indeed\.com|indeedapply|zipapply|easyapply|easy-apply|\/apply\/|candidateexperience|jobapply|job_app/.test(
      lowerUrl
    )
  );
}

function isAppliedStateActionText(text: string): boolean {
  const lower = text.toLowerCase().trim();
  if (!lower) {
    return false;
  }

  if (
    /\b(not applied|apply now|ready to apply|applied scientist|applied research|applied machine|applied deep|applied data|applied ai)\b/.test(
      lower
    )
  ) {
    return false;
  }

  return [
    /^\s*applied\s*$/i,
    /\balready applied\b/i,
    /\byou already applied\b/i,
    /\byou applied\b/i,
    /\bpreviously applied\b/i,
    /\bapplication submitted\b/i,
    /\bapplication complete\b/i,
    /\bapplication received\b/i,
    /\bapplied\s+\d+\s+(minute|hour|day|week|month)s?\s+ago\b/i,
  ].some((pattern) => pattern.test(lower));
}

function choosePreferredJobPageAction(
  best: ScoredApplyCandidate | undefined,
  bestDirect: ScoredApplyCandidate | undefined
): ScoredApplyCandidate | undefined {
  if (!best) {
    return bestDirect;
  }

  if (
    bestDirect &&
    isCompanySiteActionText(best.text) &&
    bestDirect.score >= 45
  ) {
    return bestDirect;
  }

  return best;
}

export function findMonsterApplyAction(): ApplyAction | null {
  const scopedElements = collectMonsterApplyCandidates();
  const elements =
    scopedElements.length > 0
      ? scopedElements
      : collectDeepMatchesFromSelectors(getApplyCandidateSelectors("monster"));
  const viableCandidates: Array<{
    element: HTMLElement;
    fallbackElements: HTMLElement[];
    score: number;
    url: string | null;
    text: string;
    top: number;
  }> = [];
  let best: ScoredApplyCandidate | undefined;
  let bestDirect: ScoredApplyCandidate | undefined;

  for (const element of elements) {
    const actionElement = getClickableApplyElement(element);
    const text = (getActionText(actionElement) || getActionText(element)).trim();
    const url =
      getNavigationUrl(actionElement) ??
      getNavigationUrl(element) ??
      extractLikelyApplyUrl(actionElement) ??
      extractLikelyApplyUrl(element);
    const score = scoreMonsterApplyCandidate(element, actionElement, text, url);
    const fallbackElements = collectMonsterClickFallbackElements(
      element,
      actionElement
    );

    if (score < 35) {
      continue;
    }

    viableCandidates.push({
      element: actionElement,
      fallbackElements,
      score,
      url,
      text,
      top: getMonsterActionTop(actionElement),
    });

    if (!best || score > best.score) {
      best = {
        element: actionElement,
        fallbackElements,
        score,
        url,
        text,
      };
    }
    if (
      isDirectApplyActionCandidate(text, url) &&
      (!bestDirect || score > bestDirect.score)
    ) {
      bestDirect = {
        element: actionElement,
        score,
        url,
        text,
        fallbackElements,
      };
    }
  }

  const preferredPrimaryApply = choosePreferredMonsterPrimaryApplyCandidate(
    viableCandidates
  );
  if (preferredPrimaryApply) {
    best = preferredPrimaryApply;
    bestDirect = preferredPrimaryApply;
  }

  best = choosePreferredJobPageAction(best, bestDirect);

  if (!best) {
    const extractedUrl = findExternalApplyUrlInDocument();
    if (extractedUrl) {
      return {
        type: "navigate",
        url: extractedUrl,
        description: describeApplyTarget(extractedUrl, "Apply"),
      };
    }
    return null;
  }

  const directMonsterApplyUrl = resolveMonsterFallbackUrl(best.url);
  if (
    directMonsterApplyUrl &&
    isMonsterHostedUrl(directMonsterApplyUrl)
  ) {
    return {
      type: "navigate",
      url: directMonsterApplyUrl,
      description: describeApplyTarget(
        directMonsterApplyUrl,
        best.text || "Monster apply button"
      ),
    };
  }

  return {
    type: "click",
    element: best.element,
    description: best.text || "Monster apply button",
    fallbackElements: best.fallbackElements ?? [],
    fallbackUrl: resolveMonsterFallbackUrl(best.url),
  };
}

function resolveMonsterFallbackUrl(url: string | null): string | undefined {
  if (!url || isKnownBrokenApplyUrl(url)) {
    return undefined;
  }

  const normalizedUrl = normalizeUrl(url);
  const normalizedCurrentUrl = normalizeUrl(window.location.href);
  if (!normalizedUrl || normalizedUrl === normalizedCurrentUrl) {
    return undefined;
  }

  try {
    const parsed = new URL(normalizedUrl, window.location.href);
    const monsterHosted = parsed.hostname.toLowerCase().includes("monster");
    const pathAndQuery = `${parsed.pathname.toLowerCase()}${parsed.search.toLowerCase()}`;

    if (
      monsterHosted &&
      !/\/apply\b|application|candidate|jobapply|start-apply|applytojob/i.test(
        pathAndQuery
      )
    ) {
      return undefined;
    }
  } catch {
    return undefined;
  }

  if (!shouldPreferApplyNavigation(normalizedUrl, "Apply", "monster")) {
    return undefined;
  }

  return normalizedUrl;
}

function isMonsterHostedUrl(url: string): boolean {
  try {
    return new URL(url, window.location.href).hostname.toLowerCase().includes("monster");
  } catch {
    return false;
  }
}

function getMonsterActionTop(element: HTMLElement): number {
  const rect = element.getBoundingClientRect();
  return Number.isFinite(rect.top) ? rect.top : 0;
}

function getMonsterTitleRegionBelowThreshold(titleRect: DOMRect): number {
  return Math.max(
    MIN_MONSTER_TITLE_REGION_GAP_BELOW,
    Math.min(
      MAX_MONSTER_TITLE_REGION_GAP_BELOW,
      Math.round(titleRect.height * MONSTER_TITLE_REGION_BELOW_MULTIPLIER)
    )
  );
}

function getMonsterTitleRegionAboveThreshold(titleRect: DOMRect): number {
  return Math.max(
    MIN_MONSTER_TITLE_REGION_GAP_ABOVE,
    Math.min(
      MAX_MONSTER_TITLE_REGION_GAP_ABOVE,
      Math.round(titleRect.height * MONSTER_TITLE_REGION_ABOVE_MULTIPLIER)
    )
  );
}

function getMonsterSelectionScore(
  candidate: {
    element: HTMLElement;
    score: number;
    url: string | null;
    text: string;
  },
  titleAnchor?: HTMLElement | null,
  detailBoundary?: HTMLElement | null
): number {
  let selectionScore = candidate.score;

  if (isMonsterPrimaryApplyLabel(candidate.text, candidate.url)) {
    selectionScore += 40;
  }

  if (
    titleAnchor &&
    isMonsterCandidateInPrimaryTitleRegion(
      candidate.element,
      titleAnchor,
      detailBoundary
    )
  ) {
    selectionScore += 32;
  }

  if (
    detailBoundary &&
    isMonsterCandidateAboveDetailBoundary(candidate.element, detailBoundary)
  ) {
    selectionScore += 20;
  }

  const normalizedText = cleanText(candidate.text).toLowerCase();
  if (
    normalizedText === "apply now" ||
    normalizedText === "quick apply" ||
    normalizedText === "easy apply"
  ) {
    selectionScore += 8;
  }

  return selectionScore;
}

function choosePreferredMonsterPrimaryApplyCandidate(
  candidates: Array<{
    element: HTMLElement;
    fallbackElements: HTMLElement[];
    score: number;
    url: string | null;
    text: string;
    top: number;
  }>
):
  | {
      element: HTMLElement;
      score: number;
      url: string | null;
      text: string;
      top: number;
    }
  | undefined {
  const primaryApplyCandidates = candidates.filter(
    (candidate) =>
      !isMonsterSecondaryApplyContext(candidate.element) &&
      isMonsterPrimaryApplyLabel(candidate.text, candidate.url)
  );
  const detailBoundary = findMonsterPrimaryDetailBoundary();
  const primaryTitleAnchor = findMonsterPrimaryTitleAnchor();
  const titleAnchoredPrimaryCandidates = primaryTitleAnchor
    ? primaryApplyCandidates.filter((candidate) =>
        isMonsterCandidateInPrimaryTitleRegion(
          candidate.element,
          primaryTitleAnchor,
          detailBoundary
        )
      )
    : [];
  const primaryCandidatesAboveDetailBoundary = detailBoundary
    ? primaryApplyCandidates.filter((candidate) =>
        isMonsterCandidateAboveDetailBoundary(candidate.element, detailBoundary)
      )
    : [];

  if (titleAnchoredPrimaryCandidates.length >= 1) {
    return sortMonsterApplyCandidates(
      titleAnchoredPrimaryCandidates,
      primaryTitleAnchor,
      detailBoundary
    )[0];
  }

  if (primaryCandidatesAboveDetailBoundary.length >= 1) {
    return sortMonsterApplyCandidates(
      primaryCandidatesAboveDetailBoundary,
      primaryTitleAnchor,
      detailBoundary
    )[0];
  }

  if (primaryApplyCandidates.length >= 1) {
    return sortMonsterApplyCandidates(
      primaryApplyCandidates,
      primaryTitleAnchor,
      detailBoundary
    )[0];
  }

  const nonSecondaryCandidates = candidates.filter(
    (candidate) => !isMonsterSecondaryApplyContext(candidate.element)
  );
  const nonSecondaryCandidatesAboveDetailBoundary = detailBoundary
    ? nonSecondaryCandidates.filter((candidate) =>
        isMonsterCandidateAboveDetailBoundary(candidate.element, detailBoundary)
      )
    : [];

  if (nonSecondaryCandidatesAboveDetailBoundary.length >= 1) {
    return sortMonsterApplyCandidates(
      nonSecondaryCandidatesAboveDetailBoundary,
      primaryTitleAnchor,
      detailBoundary
    )[0];
  }

  if (nonSecondaryCandidates.length < 2) {
    return nonSecondaryCandidates[0];
  }

  return sortMonsterApplyCandidates(
    nonSecondaryCandidates,
    primaryTitleAnchor,
    detailBoundary
  )[0];
}

function sortMonsterApplyCandidates<
  T extends {
    element: HTMLElement;
    score: number;
    top: number;
    text: string;
    url: string | null;
  }
>(
  candidates: T[],
  titleAnchor?: HTMLElement | null,
  detailBoundary?: HTMLElement | null
): T[] {
  return candidates.sort((left, right) => {
    const leftSelectionScore = getMonsterSelectionScore(
      left,
      titleAnchor,
      detailBoundary
    );
    const rightSelectionScore = getMonsterSelectionScore(
      right,
      titleAnchor,
      detailBoundary
    );
    if (Math.abs(leftSelectionScore - rightSelectionScore) > 30) {
      return rightSelectionScore - leftSelectionScore;
    }

    if (left.top !== right.top) {
      return left.top - right.top;
    }

    if (leftSelectionScore !== rightSelectionScore) {
      return rightSelectionScore - leftSelectionScore;
    }

    if (left.score !== right.score) {
      return right.score - left.score;
    }

    const position = left.element.compareDocumentPosition(right.element);
    if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
      return -1;
    }
    if (position & Node.DOCUMENT_POSITION_PRECEDING) {
      return 1;
    }
    return 0;
  });
}

function findMonsterPrimaryDetailBoundary(): HTMLElement | null {
  const markers = Array.from(
    document.querySelectorAll<HTMLElement>(
      "h2, h3, h4, [role='heading'], [data-testid*='description' i], [data-testid*='profile' i], [class*='profileInsights'], [class*='profile-insights']"
    )
  );
  let bestMarker: HTMLElement | null = null;
  let bestTop = Number.POSITIVE_INFINITY;

  for (const marker of markers) {
    if (!isElementVisible(marker)) {
      continue;
    }

    const text = cleanText(
      [
        marker.innerText || marker.textContent || "",
        marker.getAttribute("aria-label"),
        marker.getAttribute("title"),
        marker.getAttribute("data-testid"),
        marker.className,
      ]
        .filter(Boolean)
        .join(" ")
    ).toLowerCase();

    if (!MONSTER_DETAIL_BOUNDARY_PATTERNS.some((pattern) => pattern.test(text))) {
      continue;
    }

    const top = getMonsterActionTop(marker);
    if (top < bestTop) {
      bestTop = top;
      bestMarker = marker;
    }
  }

  return bestMarker;
}

function findMonsterPrimaryTitleAnchor(): HTMLElement | null {
  const selectors = [
    "h1",
    "[data-testid*='job-title' i]",
    "[data-testid*='jobTitle' i]",
    "[class*='job-title']",
    "[class*='jobTitle']",
  ];
  let bestTitle: HTMLElement | null = null;
  let bestTop = Number.POSITIVE_INFINITY;

  for (const selector of selectors) {
    let matches: HTMLElement[];
    try {
      matches = Array.from(document.querySelectorAll<HTMLElement>(selector));
    } catch {
      continue;
    }

    for (const match of matches) {
      if (!isElementVisible(match)) {
        continue;
      }

      const text = cleanText(match.innerText || match.textContent || "");
      if (text.length < 3) {
        continue;
      }

      const top = getMonsterActionTop(match);
      if (top < bestTop) {
        bestTop = top;
        bestTitle = match;
      }
    }
  }

  return bestTitle;
}

function isMonsterCandidateInPrimaryTitleRegion(
  element: HTMLElement,
  titleAnchor: HTMLElement,
  detailBoundary?: HTMLElement | null
): boolean {
  if (detailBoundary && !isMonsterCandidateAboveDetailBoundary(element, detailBoundary)) {
    return false;
  }

  const titleRect = titleAnchor.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  if (
    !Number.isFinite(titleRect.top) ||
    !Number.isFinite(titleRect.bottom) ||
    !Number.isFinite(elementRect.top) ||
    !Number.isFinite(elementRect.bottom)
  ) {
    return false;
  }

  const verticalGapBelow = elementRect.top - titleRect.bottom;
  const verticalGapAbove = titleRect.top - elementRect.bottom;
  const horizontalGap =
    elementRect.left > titleRect.right
      ? elementRect.left - titleRect.right
      : titleRect.left > elementRect.right
        ? titleRect.left - elementRect.right
        : 0;
  const minimumTitleOverlap = Math.min(
    32,
    Math.max(16, Math.round(titleRect.height * 0.5))
  );

  return (
    elementRect.bottom >= titleRect.top + minimumTitleOverlap &&
    verticalGapBelow <= getMonsterTitleRegionBelowThreshold(titleRect) &&
    verticalGapAbove <= getMonsterTitleRegionAboveThreshold(titleRect) &&
    horizontalGap <= MONSTER_TITLE_REGION_HORIZONTAL_ALLOWANCE
  );
}

function isMonsterCandidateAboveDetailBoundary(
  element: HTMLElement,
  detailBoundary: HTMLElement
): boolean {
  if (detailBoundary.contains(element)) {
    return false;
  }

  const boundaryTop = getMonsterActionTop(detailBoundary);
  const elementTop = getMonsterActionTop(element);
  if (elementTop < boundaryTop - 8) {
    return true;
  }

  const position = element.compareDocumentPosition(detailBoundary);
  return Boolean(position & Node.DOCUMENT_POSITION_FOLLOWING);
}

function collectMonsterClickFallbackElements(
  sourceElement: HTMLElement,
  actionElement: HTMLElement
): HTMLElement[] {
  const fallbacks: HTMLElement[] = [];
  const seen = new Set<HTMLElement>([actionElement]);

  for (const element of getMonsterComposedAncestors(actionElement)) {
    if (
      element !== actionElement &&
      isElementVisible(element) &&
      isMonsterFallbackClickElement(element)
    ) {
      seen.add(element);
      fallbacks.push(element);
    }
  }

  for (const element of getMonsterComposedAncestors(sourceElement)) {
    if (
      !seen.has(element) &&
      element !== actionElement &&
      isElementVisible(element) &&
      isMonsterFallbackClickElement(element)
    ) {
      seen.add(element);
      fallbacks.push(element);
    }
  }

  return fallbacks;
}

function getMonsterComposedAncestors(element: HTMLElement): HTMLElement[] {
  const ancestors: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();
  let current: HTMLElement | null = element;

  while (current && !seen.has(current)) {
    seen.add(current);
    ancestors.push(current);
    current = getMonsterComposedParent(current);
  }

  return ancestors;
}

function getMonsterComposedParent(element: HTMLElement): HTMLElement | null {
  if (element.parentElement) {
    return element.parentElement;
  }

  const root = element.getRootNode();
  if (root instanceof ShadowRoot && root.host instanceof HTMLElement) {
    return root.host;
  }

  return null;
}

function isMonsterFallbackClickElement(element: HTMLElement): boolean {
  const attrs = [
    element.tagName,
    element.getAttribute("data-testid"),
    element.getAttribute("data-track"),
    element.getAttribute("data-action"),
    element.getAttribute("aria-label"),
    element.getAttribute("title"),
    element.className,
    element.id,
  ]
    .join(" ")
    .toLowerCase();
  const tagName = element.tagName.toLowerCase();

  if (
    tagName === "apply-button-wc" ||
    tagName === "monster-apply-button" ||
    tagName === "monster-apply-button-wc"
  ) {
    return true;
  }

  if (
    tagName.includes("-") &&
    attrs.includes("apply")
  ) {
    return true;
  }

  const text = cleanText(
    getActionText(element) ||
      element.getAttribute("aria-label") ||
      element.getAttribute("title") ||
      ""
  );
  const url = getNavigationUrl(element);

  if (
    (element.matches("a[href], button, input[type='submit'], input[type='button'], [role='button']") ||
      element.hasAttribute("onclick")) &&
    isMonsterPrimaryApplyLabel(text, url)
  ) {
    return true;
  }

  return /apply-button-wc|monster-apply-button|applybutton|svx_applybutton/.test(
    attrs
  );
}

function isMonsterPrimaryApplyLabel(text: string, url: string | null): boolean {
  const normalizedText = text
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const lowerUrl = url?.toLowerCase() ?? "";

  if (
    normalizedText === "apply" ||
    normalizedText === "apply now" ||
    normalizedText === "quick apply" ||
    normalizedText === "easy apply" ||
    normalizedText.endsWith(" apply") ||
    normalizedText.startsWith("apply ")
  ) {
    return true;
  }

  return (
    lowerUrl.includes("/apply") ||
    lowerUrl.includes("candidate") ||
    lowerUrl.includes("application")
  );
}

function isMonsterSecondaryApplyContext(element: HTMLElement): boolean {
  if (
    element.closest(
      "aside, [class*='related'], [class*='recommended'], [class*='suggested'], [class*='similar'], [class*='resume-resource'], [class*='resumeResource']"
    )
  ) {
    return true;
  }

  const section = element.closest<HTMLElement>("section, article, div, aside");
  const sectionText = cleanText(section?.textContent || "").toLowerCase();

  return (
    sectionText.includes("similar jobs") ||
    sectionText.includes("recommended jobs") ||
    sectionText.includes("suggested jobs") ||
    sectionText.includes("more jobs") ||
    sectionText.includes("resume resources")
  );
}

function collectMonsterApplyCandidates(): HTMLElement[] {
  const selectors = getApplyCandidateSelectors("monster");
  const genericActionSelectors = [
    "a[href]",
    "button",
    "input[type='submit']",
    "input[type='button']",
    "[role='button']",
  ];
  const surfaces = collectCurrentJobSurfaceMatches("monster");
  const matches: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();

  for (const surface of surfaces) {
    for (const selector of [...selectors, ...genericActionSelectors]) {
      let scopedMatches: HTMLElement[];
      try {
        scopedMatches = Array.from(surface.querySelectorAll<HTMLElement>(selector));
      } catch {
        continue;
      }

      for (const element of scopedMatches) {
        if (seen.has(element)) {
          continue;
        }

        seen.add(element);
        matches.push(element);
      }
    }

    for (const host of collectShadowHosts(surface)) {
      for (const selector of [...selectors, ...genericActionSelectors]) {
        let shadowMatches: HTMLElement[];
        try {
          shadowMatches = Array.from(
            host.shadowRoot?.querySelectorAll<HTMLElement>(selector) ?? []
          );
        } catch {
          continue;
        }

        for (const element of shadowMatches) {
          if (seen.has(element)) {
            continue;
          }

          seen.add(element);
          matches.push(element);
        }
      }
    }
  }

  return matches;
}

function collectCurrentJobSurfaceMatches(site: SiteKey | null): HTMLElement[] {
  const selectors = [
    ...getPrimaryCurrentJobSurfaceSelectors(site),
    "[role='main']",
    "main",
    "article",
  ];
  const matches: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();

  for (const selector of selectors) {
    let elements: HTMLElement[];
    try {
      elements = Array.from(document.querySelectorAll<HTMLElement>(selector));
    } catch {
      continue;
    }

    for (const element of elements) {
      if (seen.has(element)) {
        continue;
      }

      seen.add(element);
      matches.push(element);
    }
  }

  return matches;
}

function scoreMonsterApplyCandidate(
  sourceElement: HTMLElement,
  actionElement: HTMLElement,
  text: string,
  url: string | null
): number {
  const attrs = [
    sourceElement.getAttribute("data-testid"),
    sourceElement.getAttribute("data-track"),
    sourceElement.getAttribute("data-action"),
    sourceElement.getAttribute("aria-label"),
    sourceElement.getAttribute("title"),
    sourceElement.className,
    sourceElement.id,
    sourceElement.tagName,
    actionElement.getAttribute("data-testid"),
    actionElement.getAttribute("data-track"),
    actionElement.getAttribute("data-action"),
    actionElement.getAttribute("aria-label"),
    actionElement.getAttribute("title"),
    actionElement.className,
    actionElement.id,
    actionElement.tagName,
  ]
    .join(" ")
    .toLowerCase();
  const fallbackText =
    !text.trim() &&
    (url || /apply-button-wc|monster-apply-button|applybutton|svx_applybutton/.test(attrs))
      ? "Apply"
      : text;
  const lower = fallbackText.toLowerCase().trim();

  if (
    !lower ||
    lower.includes("save") ||
    lower.includes("share") ||
    lower.includes("alert") ||
    lower.includes("sign") ||
    lower.includes("report") ||
    lower.includes("dismiss") ||
    lower.includes("close") ||
    lower.includes("filter") ||
    lower.includes("refine") ||
    lower.includes("sort")
  ) {
    return -1;
  }

  const brokenUrl = isKnownBrokenApplyUrl(url);
  let score = scoreApplyElement(fallbackText, brokenUrl ? null : url, actionElement, "job-page");

  if (
    score < 0 &&
    !(brokenUrl && /apply-button-wc|monster-apply-button|applybutton|svx_applybutton/.test(attrs))
  ) {
    return -1;
  }

  score = Math.max(score, 0);

  if (attrs.includes("svx_applybutton")) score += 30;
  if (attrs.includes("apply-button-wc") || attrs.includes("monster-apply-button")) score += 28;
  if (attrs.includes("applybutton")) score += 20;

  if (lower === "apply" || lower === "apply now") score += 16;
  if (lower.includes("apply on company") || lower.includes("company site")) score += 14;

  const lowerUrl = url?.toLowerCase() ?? "";
  if (lowerUrl.includes("/job-openings/") && lowerUrl.includes("/apply")) score += 35;
  if (lowerUrl.includes("job-openings.monster.com")) score += 28;
  if (lowerUrl.includes("candidate") || lowerUrl.includes("application")) score += 18;

  if (
    actionElement.closest("header, nav, footer") &&
    !actionElement.closest("[data-testid*='job'], [class*='job'], [class*='Job']")
  ) {
    score -= 40;
  }
  if (isMonsterSecondaryApplyContext(actionElement)) {
    score -= 36;
  }
  if (
    /\b(related|recommended|suggested|similar|more jobs)\b/i.test(
      cleanText(
        actionElement.closest<HTMLElement>("section, aside, article, div")?.textContent || ""
      )
    )
  ) {
    score -= 28;
  }
  if (actionElement.closest("aside")) score -= 12;
  if (actionElement.closest("main, article, [role='main'], section")) score += 12;
  if (actionElement.closest("[data-testid*='job'], [class*='job'], [class*='Job']")) score += 10;

  if (brokenUrl) {
    score += 24;
  }

  return score;
}

export function findZipRecruiterApplyAction(): ApplyAction | null {
  if (hasZipRecruiterAppliedConfirmation()) {
    return null;
  }

  const selectors = [
    "a[data-testid*='apply' i]",
    "button[data-testid='apply-button']",
    "button[data-testid*='apply']",
    "[data-testid*='quick-apply' i]",
    "[data-qa*='apply' i]",
    "[data-testid*='company-apply' i]",
    "[data-qa*='company-apply' i]",
    "[class*='apply_button']",
    "[class*='applyButton']",
    "[class*='quickApply']",
    "[class*='quick-apply']",
    "[class*='company-apply']",
    "[class*='companyApply']",
    "button[name='apply']",
    "button[data-testid='one-click-apply']",
    "[class*='one-click']",
    "[aria-label*='apply' i]",
    "[aria-label*='company site' i]",
    "[title*='apply' i]",
    "a[href*='/apply/']",
    "a[href*='zipapply']",
    "a[href*='jobapply']",
    "a[href*='candidate']",
  ];
  const scopedElements = collectZipRecruiterApplyCandidates(selectors);
  const candidateElements =
    scopedElements.length > 0
      ? scopedElements
      : collectDeepMatchesFromSelectors(selectors);

  let best:
    | {
        element: HTMLElement;
        score: number;
        text: string;
        url: string | null;
      }
    | undefined;
  let bestDirect: ScoredApplyCandidate | undefined;
  const viableCandidates: Array<{
    element: HTMLElement;
    score: number;
    text: string;
    url: string | null;
    top: number;
  }> = [];

  for (const element of candidateElements) {
    const actionElement = getClickableApplyElement(element);
    if (!isElementVisible(actionElement)) {
      continue;
    }

    const text = cleanText(
      getActionText(actionElement) ||
        getActionText(element) ||
        actionElement.getAttribute("aria-label") ||
        actionElement.getAttribute("title") ||
        actionElement.getAttribute("value") ||
        actionElement.getAttribute("data-testid") ||
        actionElement.getAttribute("data-qa") ||
        element.getAttribute("aria-label") ||
        element.getAttribute("title") ||
        element.getAttribute("value") ||
        element.getAttribute("data-testid") ||
        element.getAttribute("data-qa") ||
        ""
    );
    const lower = text.toLowerCase();
    if (
      !lower ||
      isAppliedStateActionText(lower) ||
      lower.includes("save") ||
      lower.includes("share") ||
      lower.includes("alert") ||
      lower.includes("sign in") ||
      lower.includes("job alert") ||
      lower.includes("my jobs") ||
      lower.includes("saved jobs")
    ) {
      continue;
    }

    const url = getNavigationUrl(actionElement) ?? getNavigationUrl(element);
    if (isZipRecruiterCandidatePortalUrl(url)) {
      continue;
    }
    const attrs = [
      actionElement.getAttribute("data-testid"),
      actionElement.getAttribute("data-qa"),
      actionElement.getAttribute("aria-label"),
      actionElement.getAttribute("title"),
      actionElement.className,
      actionElement.id,
      element.getAttribute("data-testid"),
      element.getAttribute("data-qa"),
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.className,
      element.id,
    ]
      .join(" ")
      .toLowerCase();
    const hasDirectApplySignal =
      isDirectApplyActionCandidate(text, url) ||
      (/apply-button|one-click|quick-apply|quickapply/.test(attrs) &&
        !/company-apply|companyapply/.test(attrs));
    const hasExplicitCompanyApplySignal =
      isZipRecruiterExplicitCompanyApplyControl(text, attrs, url);

    if (
      !lower &&
      !hasDirectApplySignal &&
      !hasExplicitCompanyApplySignal
    ) {
      continue;
    }

    if (!hasDirectApplySignal && !hasExplicitCompanyApplySignal) {
      continue;
    }

    let score = 0;
    if (hasDirectApplySignal) score += 72;
    if (hasExplicitCompanyApplySignal) score += 58;
    if (lower === "apply now" || lower === "apply") score += 118;
    if (lower.includes("1-click apply") || lower.includes("1 click apply")) score += 116;
    if (isTapApplyActionText(lower)) score += 116;
    if (lower.includes("quick apply") || lower.includes("easy apply")) score += 112;
    if (lower.includes("apply on company") || lower.includes("apply on employer")) score += 88;
    if (lower.includes("continue to company") || lower.includes("company site")) score += 80;
    if (hasDirectApplySignal && lower.includes("apply")) score += 82;
    if (lower.includes("continue")) score += 40;
    if (attrs.includes("apply")) score += 25;
    if (attrs.includes("quick")) score += 15;
    if (hasExplicitCompanyApplySignal && attrs.includes("company")) score += 15;
    if (url && shouldPreferApplyNavigation(url, text, "ziprecruiter")) score += 35;
    if (url && /zipapply|jobapply|\/apply\/|candidateexperience/i.test(url)) score += 35;

    if (score < 45) {
      continue;
    }

    viableCandidates.push({
      element: actionElement,
      score,
      text,
      url,
      top: getZipRecruiterActionTop(actionElement),
    });

    if (!best || score > best.score) {
      best = { element: actionElement, score, text, url };
    }
    if (
      isDirectApplyActionCandidate(text, url) &&
      (!bestDirect || score > bestDirect.score)
    ) {
      bestDirect = { element: actionElement, score, text, url };
    }
  }

  if (!best) {
    for (const element of collectDeepMatchesFromSelectors([
      "a[href]",
      "button",
      "[role='button']",
    ])) {
      const actionElement = getClickableApplyElement(element);
      if (!isElementVisible(actionElement)) {
        continue;
      }

      const text = cleanText(
        getActionText(actionElement) ||
          getActionText(element) ||
          actionElement.getAttribute("aria-label") ||
          actionElement.getAttribute("title") ||
          actionElement.getAttribute("value") ||
          actionElement.getAttribute("data-testid") ||
          actionElement.getAttribute("data-qa") ||
          element.getAttribute("aria-label") ||
          element.getAttribute("title") ||
          element.getAttribute("value") ||
          element.getAttribute("data-testid") ||
          element.getAttribute("data-qa") ||
          ""
      );
      const lower = text.toLowerCase();
      if (
        !lower ||
        isAppliedStateActionText(lower) ||
        [
          "save",
          "share",
          "alert",
          "sign in",
          "job alert",
          "subscribe",
          "my jobs",
          "saved jobs",
        ].some((token) =>
          lower.includes(token)
        )
      ) {
        continue;
      }

      const url = getNavigationUrl(actionElement) ?? getNavigationUrl(element);
      if (isZipRecruiterCandidatePortalUrl(url)) {
        continue;
      }
      const attrs = [
        actionElement.getAttribute("data-testid"),
        actionElement.getAttribute("data-qa"),
        actionElement.getAttribute("aria-label"),
        actionElement.getAttribute("title"),
        actionElement.className,
        actionElement.id,
        element.getAttribute("data-testid"),
        element.getAttribute("data-qa"),
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        element.className,
        element.id,
      ]
        .join(" ")
        .toLowerCase();
      const hasDirectApplySignal =
        isDirectApplyActionCandidate(text, url) ||
        (/apply-button|one-click|quick-apply|quickapply/.test(attrs) &&
          !/company-apply|companyapply/.test(attrs));
      const hasExplicitCompanyApplySignal =
        isZipRecruiterExplicitCompanyApplyControl(text, attrs, url);
      if (
        !lower &&
        !hasDirectApplySignal &&
        !hasExplicitCompanyApplySignal
      ) {
        continue;
      }
      if (!hasDirectApplySignal && !hasExplicitCompanyApplySignal) {
        continue;
      }
      let score = 0;
      if (hasDirectApplySignal) score += 85;
      if (hasExplicitCompanyApplySignal) score += 68;
      if (/\bapply\b/.test(lower)) score += 20;
      if (isTapApplyActionText(lower)) score += 24;
      if (url && shouldPreferApplyNavigation(url, text, "ziprecruiter")) score += 35;
      if (url && /zipapply|jobapply|\/apply\/|candidateexperience/i.test(url)) score += 30;

      if (score < 55) {
        continue;
      }

      viableCandidates.push({
        element: actionElement,
        score,
        text,
        url,
        top: getZipRecruiterActionTop(actionElement),
      });

      if (!best || score > best.score) {
        best = { element: actionElement, score, text, url };
      }
      if (
        isDirectApplyActionCandidate(text, url) &&
        (!bestDirect || score > bestDirect.score)
      ) {
        bestDirect = { element: actionElement, score, text, url };
      }
    }
  }

  const preferredPrimaryApply = choosePreferredZipRecruiterPrimaryApplyCandidate(
    viableCandidates
  );
  if (preferredPrimaryApply) {
    best = preferredPrimaryApply;
    bestDirect = preferredPrimaryApply;
  }

  best = choosePreferredJobPageAction(best, bestDirect);

  if (!best) {
    return null;
  }

  if (best.url && shouldPreferApplyNavigation(best.url, best.text, "ziprecruiter")) {
    return {
      type: "navigate",
      url: best.url,
      description: describeApplyTarget(best.url, best.text || "ZipRecruiter apply"),
    };
  }

  return {
    type: "click",
    element: best.element,
    description: best.text || "ZipRecruiter apply",
  };
}

function collectZipRecruiterApplyCandidates(selectors: string[]): HTMLElement[] {
  const modalRoots = getVisibleZipRecruiterApplyModals();
  const roots =
    modalRoots.length > 0
      ? modalRoots
      : collectCurrentJobSurfaceMatches("ziprecruiter");

  return collectActionCandidatesFromRoots(roots, selectors);
}

function collectActionCandidatesFromRoots(
  roots: HTMLElement[],
  selectors: string[]
): HTMLElement[] {
  const genericActionSelectors = [
    "a[href]",
    "button",
    "input[type='submit']",
    "input[type='button']",
    "[role='button']",
  ];
  const matches: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();

  for (const root of roots) {
    for (const selector of [...selectors, ...genericActionSelectors]) {
      let scopedMatches: HTMLElement[];
      try {
        scopedMatches = Array.from(root.querySelectorAll<HTMLElement>(selector));
      } catch {
        continue;
      }

      for (const element of scopedMatches) {
        if (seen.has(element)) {
          continue;
        }

        seen.add(element);
        matches.push(element);
      }
    }

    for (const host of collectShadowHosts(root)) {
      for (const selector of [...selectors, ...genericActionSelectors]) {
        let shadowMatches: HTMLElement[];
        try {
          shadowMatches = Array.from(
            host.shadowRoot?.querySelectorAll<HTMLElement>(selector) ?? []
          );
        } catch {
          continue;
        }

        for (const element of shadowMatches) {
          if (seen.has(element)) {
            continue;
          }

          seen.add(element);
          matches.push(element);
        }
      }
    }
  }

  return matches;
}

function getZipRecruiterActionTop(element: HTMLElement): number {
  const rect = element.getBoundingClientRect();
  return Number.isFinite(rect.top) ? rect.top : 0;
}

function choosePreferredZipRecruiterPrimaryApplyCandidate(
  candidates: Array<{
    element: HTMLElement;
    score: number;
    text: string;
    url: string | null;
    top: number;
  }>
): 
  | {
      element: HTMLElement;
      score: number;
      text: string;
      url: string | null;
      top: number;
    }
  | undefined {
  const primaryCandidates = candidates.filter((candidate) =>
    /^(1[\s-]?click apply|(?:1|one)[\s-]?tap apply|tap to apply|quick apply|apply|apply now|easy apply)$/i.test(
      candidate.text.trim()
    )
  );

  if (primaryCandidates.length < 2) {
    return undefined;
  }

  return primaryCandidates.sort((left, right) => {
    if (left.top !== right.top) {
      return left.top - right.top;
    }

    if (left.score !== right.score) {
      return right.score - left.score;
    }

    const position = left.element.compareDocumentPosition(right.element);
    if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
      return -1;
    }
    if (position & Node.DOCUMENT_POSITION_PRECEDING) {
      return 1;
    }
    return 0;
  })[0];
}

export function findGlassdoorApplyAction(): ApplyAction | null {
  const selectors = [
    "a[data-test*='apply' i]",
    "button[data-test*='apply' i]",
    "[data-test*='easy-apply' i]",
    "[data-test*='employer-site' i]",
    "[data-test*='apply-button' i]",
    "[data-test*='job-apply' i]",
    "[class*='easyApply']",
    "[class*='easy-apply']",
    "[class*='applyButton']",
    "[class*='apply-button']",
    "[aria-label*='apply' i]",
    "[title*='apply' i]",
    "a[href*='easyapply' i]",
    "a[href*='easy-apply' i]",
    "a[href*='apply' i]",
  ];

  let best:
    | {
        element: HTMLElement;
        score: number;
        text: string;
        url: string | null;
      }
    | undefined;
  let bestDirect: ScoredApplyCandidate | undefined;

  for (const element of collectDeepMatchesFromSelectors(selectors)) {
    const actionElement = getClickableApplyElement(element);
    if (!isElementVisible(actionElement)) {
      continue;
    }

    const text = (getActionText(actionElement) || getActionText(element)).trim();
    const lower = text.toLowerCase();
    if (
      !lower ||
      lower.includes("save") ||
      lower.includes("share") ||
      lower.includes("salary") ||
      lower.includes("sign in") ||
      lower.includes("job alert")
    ) {
      continue;
    }

    const url =
      getNavigationUrl(actionElement) ??
      getNavigationUrl(element) ??
      extractLikelyApplyUrl(actionElement) ??
      extractLikelyApplyUrl(element);
    const attrs = [
      actionElement.getAttribute("data-test"),
      actionElement.getAttribute("data-testid"),
      actionElement.getAttribute("aria-label"),
      actionElement.getAttribute("title"),
      actionElement.className,
      actionElement.id,
      element.getAttribute("data-test"),
      element.getAttribute("data-testid"),
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.className,
      element.id,
    ]
      .join(" ")
      .toLowerCase();

    let score = scoreApplyElement(text, url, actionElement, "job-page");

    if (lower === "easy apply") score += 24;
    if (lower === "apply now") score += 18;
    if (lower.includes("employer site") || lower.includes("company site")) score += 18;
    if (attrs.includes("easy-apply") || attrs.includes("easyapply")) score += 20;
    if (attrs.includes("apply-button")) score += 12;
    if (attrs.includes("employer-site") || attrs.includes("company-site")) score += 12;
    if (url && shouldPreferApplyNavigation(url, text, "glassdoor")) score += 22;
    if (actionElement.closest("header, footer, nav")) score -= 30;
    if (actionElement.closest("main, article, [role='main'], section")) score += 10;

    if (score < 40) {
      continue;
    }

    if (!best || score > best.score) {
      best = { element: actionElement, score, text, url };
    }
    if (
      isDirectApplyActionCandidate(text, url) &&
      (!bestDirect || score > bestDirect.score)
    ) {
      bestDirect = { element: actionElement, score, text, url };
    }
  }

  best = choosePreferredJobPageAction(best, bestDirect);

  if (!best) {
    return null;
  }

  if (best.url && shouldPreferApplyNavigation(best.url, best.text, "glassdoor")) {
    return {
      type: "navigate",
      url: best.url,
      description: describeApplyTarget(best.url, best.text || "Glassdoor apply"),
    };
  }

  return {
    type: "click",
    element: best.element,
    description: best.text || "Glassdoor apply",
  };
}

export function findGreenhouseApplyAction(): ApplyAction | null {
  const currentUrl = window.location.href.toLowerCase();
  const isCompanyHostedGreenhousePage =
    currentUrl.includes("gh_jid=") ||
    currentUrl.includes("gh_src=") ||
    currentUrl.includes("job_application") ||
    currentUrl.includes("job-application") ||
    currentUrl.includes("job_app");
  const selectors = [
    "button[aria-label='Apply']",
    "button[aria-label*='apply' i]",
    "button[title*='apply' i]",
    "button[data-testid*='apply' i]",
    "a[data-testid*='apply' i]",
    "button[data-qa*='apply' i]",
    "a[data-qa*='apply' i]",
    "button[data-automation*='apply' i]",
    "a[data-automation*='apply' i]",
    "button[id*='apply' i]",
    "a[id*='apply' i]",
    "[class*='apply-button']",
    "[class*='ApplyButton']",
    ".job__header button",
    ".job__header [role='button']",
    ".job__header a[href]",
    "[class*='sticky'] button",
    "[class*='sticky'] [role='button']",
    "[class*='sticky'] a[href]",
    "main.job-post button",
    "main.job-post [role='button']",
    "main.job-post a[href]",
    "button",
    "a[href]",
    "[role='button']",
    ...getSiteApplyCandidateSelectors("greenhouse"),
  ];
  const scopedElements = collectGreenhouseApplyCandidates(selectors);
  const candidateElements =
    scopedElements.length > 0
      ? scopedElements
      : collectDeepMatchesFromSelectors(selectors);

  let best:
    | {
        element: HTMLElement;
        score: number;
        text: string;
        url: string | null;
      }
    | undefined;
  let bestDirect: ScoredApplyCandidate | undefined;

  for (const element of candidateElements) {
    const actionElement = getClickableApplyElement(element);
    if (!isElementVisible(actionElement)) {
      continue;
    }

    const text = cleanText(
      getActionText(actionElement) ||
        getActionText(element) ||
        actionElement.getAttribute("aria-label") ||
        actionElement.getAttribute("title") ||
        element.getAttribute("aria-label") ||
        element.getAttribute("title") ||
        ""
    );
    const lower = text.toLowerCase();
    if (
      !lower ||
      lower.includes("back to jobs") ||
      lower.includes("save") ||
      lower.includes("share") ||
      lower.includes("alert") ||
      lower.includes("sign in") ||
      lower.includes("learn more")
    ) {
      continue;
    }

    const url = getNavigationUrl(actionElement) ?? getNavigationUrl(element);
    let score = scoreApplyElement(text, url, actionElement, "job-page");

    if (score < 0) {
      continue;
    }

    if (isCompanyHostedGreenhousePage && (lower === "apply" || lower === "apply now")) {
      score += 28;
    }
    if (lower === "apply") score += 72;
    if (lower === "apply now") score += 64;
    if (lower.includes("apply for this")) score += 40;
    if (actionElement.tagName === "BUTTON") score += 18;
    if (actionElement.closest(".job__header, [class*='job__header']")) score += 56;
    if (
      actionElement.closest(
        "main.job-post, main[class*='job-post'], [class*='job-post'], [class*='opening']"
      )
    ) {
      score += 22;
    }

    const attrs = [
      actionElement.getAttribute("aria-label"),
      actionElement.getAttribute("title"),
      actionElement.className,
      actionElement.id,
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.className,
      element.id,
    ]
      .join(" ")
      .toLowerCase();
    if (attrs.includes("btn--pill")) score += 14;
    if (
      actionElement.hasAttribute("data-testid") ||
      actionElement.hasAttribute("data-qa") ||
      actionElement.hasAttribute("data-automation") ||
      element.hasAttribute("data-testid") ||
      element.hasAttribute("data-qa") ||
      element.hasAttribute("data-automation")
    ) {
      score += 10;
    }
    if (attrs.includes("apply-button") || attrs.includes("applybutton")) {
      score += 18;
    }
    if (url && /greenhouse|job_app|\/apply\b/i.test(url)) score += 22;
    if (actionElement.closest("[class*='sticky'], [class*='floating']")) {
      score += 18;
    }

    if (
      actionElement.closest("header, nav, footer, aside") &&
      !actionElement.closest(
        ".job__header, [class*='job__header'], main.job-post, main[class*='job-post']"
      )
    ) {
      score -= 30;
    }

    if (score < 55) {
      continue;
    }

    if (!best || score > best.score) {
      best = { element: actionElement, score, text, url };
    }
    if (
      isDirectApplyActionCandidate(text, url) &&
      (!bestDirect || score > bestDirect.score)
    ) {
      bestDirect = { element: actionElement, score, text, url };
    }
  }

  best = choosePreferredJobPageAction(best, bestDirect);

  if (!best) {
    return findGreenhouseExactApplyFallback(isCompanyHostedGreenhousePage);
  }

  if (best.url && shouldPreferApplyNavigation(best.url, best.text, "greenhouse")) {
    return {
      type: "navigate",
      url: best.url,
      description: describeApplyTarget(best.url, best.text || "Greenhouse apply"),
    };
  }

  return {
    type: "click",
    element: best.element,
    description: best.text || "Greenhouse apply",
  };
}

function findGreenhouseExactApplyFallback(
  isCompanyHostedGreenhousePage: boolean
): ApplyAction | null {
  let best:
    | {
        element: HTMLElement;
        text: string;
        url: string | null;
        score: number;
      }
    | undefined;

  for (const candidate of collectDeepMatchesFromSelectors([
    "button",
    "a[href]",
    "[role='button']",
    "input[type='button']",
    "input[type='submit']",
  ])) {
    const actionElement = getClickableApplyElement(candidate);
    if (!isElementVisible(actionElement)) {
      continue;
    }

    const text = cleanText(
      getActionText(actionElement) ||
        getActionText(candidate) ||
        actionElement.getAttribute("aria-label") ||
        actionElement.getAttribute("title") ||
        candidate.getAttribute("aria-label") ||
        candidate.getAttribute("title") ||
        ""
    );
    const lower = text.toLowerCase();
    if (
      !/^(apply|apply now|apply for this job|start application|start your application)$/i.test(
        lower
      )
    ) {
      continue;
    }

    const url = getNavigationUrl(actionElement) ?? getNavigationUrl(candidate);
    let score = 100;
    if (actionElement.tagName === "BUTTON") score += 16;
    if (isCompanyHostedGreenhousePage) score += 24;
    if (url && shouldPreferApplyNavigation(url, text, "greenhouse")) score += 20;
    if (actionElement.closest("main, article, section, [role='main']")) score += 14;
    if (actionElement.closest("header, nav, footer, aside")) score -= 18;

    if (!best || score > best.score) {
      best = {
        element: actionElement,
        text,
        url,
        score,
      };
    }
  }

  if (!best) {
    return null;
  }

  if (best.url && shouldPreferApplyNavigation(best.url, best.text, "greenhouse")) {
    return {
      type: "navigate",
      url: best.url,
      description: describeApplyTarget(best.url, best.text || "Greenhouse apply"),
    };
  }

  return {
    type: "click",
    element: best.element,
    description: best.text || "Greenhouse apply",
  };
}

export function findDiceApplyAction(): ApplyAction | null {
  const inlineApplyUrl = extractDiceInlineApplyUrl();
  if (inlineApplyUrl) {
    return {
      type: "navigate",
      url: inlineApplyUrl,
      description: "Dice apply page",
    };
  }

  for (const component of collectDiceApplyComponents()) {
    const root = component.shadowRoot ?? component;

    const button = root.querySelector<HTMLElement>(
      "a[href], button, input[type='submit'], [role='button']"
    );

    if (button && isElementVisible(button)) {
      const url = getNavigationUrl(button);
      if (url) {
        return {
          type: "navigate",
          url,
          description: cleanText(getActionText(button)) || "Dice apply button",
        };
      }

      return {
        type: "click",
        element: button,
        description: cleanText(getActionText(button)) || "Dice apply button",
      };
    }

    if (isElementVisible(component)) {
      const url = getNavigationUrl(component);
      if (url) {
        return {
          type: "navigate",
          url,
          description: cleanText(getActionText(component)) || "Dice apply button",
        };
      }

      return {
        type: "click",
        element: component,
        description: cleanText(getActionText(component)) || "Dice apply button",
      };
    }
  }

  let bestSurfaceAction:
    | {
        element: HTMLElement;
        text: string;
        url: string | null;
        score: number;
      }
    | undefined;

  for (const surface of collectDiceCurrentJobSurfaces()) {
    for (const candidate of Array.from(
      surface.querySelectorAll<HTMLElement>(
        "a[href], button, input[type='submit'], input[type='button'], [role='button']"
      )
    )) {
      if (isDiceNestedResultElement(candidate, surface)) {
        continue;
      }

      const actionElement = getClickableApplyElement(candidate);
      if (!isElementVisible(actionElement)) {
        continue;
      }

      const text = cleanText(
        getActionText(actionElement) ||
          getActionText(candidate) ||
          actionElement.getAttribute("aria-label") ||
          candidate.getAttribute("aria-label") ||
          actionElement.getAttribute("title") ||
          candidate.getAttribute("title") ||
          ""
      );
      const url = getNavigationUrl(actionElement) ?? getNavigationUrl(candidate);
      let score = scoreApplyElement(text, url, actionElement, "job-page");

      if (score < 0) {
        continue;
      }

      if (/^quick apply$/i.test(text)) {
        score += 18;
      }
      if (actionElement.closest("main, article, [role='main'], section")) {
        score += 8;
      }

      if (score < 55) {
        continue;
      }

      if (!bestSurfaceAction || score > bestSurfaceAction.score) {
        bestSurfaceAction = {
          element: actionElement,
          text,
          url,
          score,
        };
      }
    }
  }

  if (bestSurfaceAction) {
    if (bestSurfaceAction.url) {
      return {
        type: "navigate",
        url: bestSurfaceAction.url,
        description: bestSurfaceAction.text || "Dice apply button",
      };
    }

    return {
      type: "click",
      element: bestSurfaceAction.element,
      description: bestSurfaceAction.text || "Dice apply button",
    };
  }

  const allHosts = collectShadowHosts(document.body ?? document.documentElement);

  for (const host of allHosts) {
    if (!host.shadowRoot) {
      continue;
    }

    const applyButton = host.shadowRoot.querySelector<HTMLElement>(
      "a[href*='apply'], button[class*='apply'], [data-cy*='apply'], [aria-label*='apply' i]"
    );

    if (applyButton && isElementVisible(applyButton)) {
      const text = cleanText(getActionText(applyButton)).toLowerCase();
      if (
        text.includes("save") ||
        text.includes("share") ||
        text.includes("alert")
      ) {
        continue;
      }

      const url = getNavigationUrl(applyButton);
      if (url) {
        return {
          type: "navigate",
          url,
          description: text || "Dice apply button",
        };
      }

      return {
        type: "click",
        element: applyButton,
        description: text || "Dice apply button",
      };
    }
  }

  return null;
}

function collectGreenhouseApplyCandidates(selectors: string[]): HTMLElement[] {
  const roots = collectDeepMatchesFromSelectors([
    ".job__header",
    "[class*='job__header']",
    "main.job-post",
    "main[class*='job-post']",
    "[class*='job-post']",
    "[class*='opening']",
    "[class*='sticky']",
    "[class*='floating']",
    "[role='main']",
    "main",
    "article",
  ]).filter((root) => !root.closest("nav, footer, aside"));

  return roots.length > 0
    ? collectActionCandidatesFromRoots(roots, selectors)
    : [];
}

function collectDiceApplyComponents(): HTMLElement[] {
  const selectors =
    "button[data-testid='apply-button'], a[data-testid='apply-button'], [data-testid*='apply-button'], apply-button-wc, [data-cy='apply-button'], [data-cy*='apply'], [class*='apply-button'], [class*='ApplyButton']";
  const scopedMatches: HTMLElement[] = [];
  const scopedSeen = new Set<HTMLElement>();
  const surfaces = collectDiceCurrentJobSurfaces();

  for (const surface of surfaces) {
    for (const component of Array.from(
      surface.querySelectorAll<HTMLElement>(selectors)
    )) {
      if (
        scopedSeen.has(component) ||
        isDiceNestedResultContainer(component, surface)
      ) {
        continue;
      }

      scopedSeen.add(component);
      scopedMatches.push(component);
    }

    for (const host of collectShadowHosts(surface)) {
      if (isDiceNestedResultContainer(host, surface)) {
        continue;
      }

      for (const component of Array.from(
        host.shadowRoot?.querySelectorAll<HTMLElement>(selectors) ?? []
      )) {
        if (scopedSeen.has(component)) {
          continue;
        }

        scopedSeen.add(component);
        scopedMatches.push(component);
      }
    }
  }

  if (scopedMatches.length > 0) {
    return scopedMatches;
  }

  const fallbackMatches = Array.from(document.querySelectorAll<HTMLElement>(selectors));
  for (const host of collectShadowHosts(document.body ?? document.documentElement)) {
    if (isDiceNestedResultContainer(host)) {
      continue;
    }

    for (const component of Array.from(
      host.shadowRoot?.querySelectorAll<HTMLElement>(selectors) ?? []
    )) {
      if (!scopedSeen.has(component)) {
        scopedSeen.add(component);
        fallbackMatches.push(component);
      }
    }
  }

  return fallbackMatches.filter((component) => !isDiceNestedResultContainer(component));
}

function collectDiceCurrentJobSurfaces(): HTMLElement[] {
  const selectors = [
    "[data-testid*='job-details' i]",
    "[data-testid*='jobDetail' i]",
    "[class*='job-details']",
    "[class*='jobDetail']",
    "[class*='job-description']",
    "[class*='jobDescription']",
    "[role='main']",
    "main",
    "article",
  ];
  const surfaces: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();

  for (const selector of selectors) {
    let matches: HTMLElement[];
    try {
      matches = Array.from(document.querySelectorAll<HTMLElement>(selector));
    } catch {
      continue;
    }

    for (const match of matches) {
      if (seen.has(match)) {
        continue;
      }

      seen.add(match);
      surfaces.push(match);
    }
  }

  return surfaces;
}

function isDiceNestedResultContainer(
  element: HTMLElement,
  surface?: HTMLElement
): boolean {
  const nestedResultContainer = (
    element.matches(getDiceNestedResultSelectors().join(", "))
      ? element
      : element.closest<HTMLElement>(getDiceNestedResultSelectors().join(", "))
  ) as HTMLElement | null;

  if (!nestedResultContainer) {
    return false;
  }

  if (!surface) {
    return true;
  }

  return nestedResultContainer !== surface;
}

function isDiceNestedResultElement(
  element: HTMLElement,
  surface: HTMLElement
): boolean {
  const nestedResultContainer = element.closest<HTMLElement>(
    getDiceNestedResultSelectors().join(", ")
  );

  return Boolean(nestedResultContainer && nestedResultContainer !== surface);
}

function extractDiceInlineApplyUrl(): string | null {
  const sources = [
    ...getApplyUrlAttributeSources(),
    ...getApplyUrlScriptSources(),
    ...getApplyUrlMarkupSources(),
  ];

  for (const source of sources) {
    const normalizedSource = source
      .replace(/\\u002F/gi, "/")
      .replace(/\\u0026/gi, "&")
      .replace(/\\\//g, "/");
    const match = normalizedSource.match(
      /(?:https?:\/\/[^"'\\\s<>{}]+)?\/job-applications\/[a-f0-9-]{8,}\/start-apply(?:[^\s"'\\<>{}]*)?/i
    );
    if (!match?.[0]) {
      continue;
    }

    const normalizedUrl = normalizeUrl(
      match[0].replace(/[\\'"]+$/g, "")
    );
    if (normalizedUrl) {
      return normalizedUrl;
    }
  }

  return null;
}

export function hasIndeedApplyIframe(): boolean {
  const candidates = collectDeepMatches<HTMLElement>(
    [
      "iframe[src*='smartapply.indeed.com' i]",
      "iframe[src*='indeedapply' i]",
      "iframe[id*='indeedapply' i]",
      "iframe[name*='indeedapply' i]",
      "iframe[title*='indeed apply' i]",
      "[class*='ia-IndeedApplyWidget']",
      "[id*='indeedApplyWidget']",
    ].join(", ")
  );

  return candidates.some((candidate) => isElementVisible(candidate));
}

export function hasZipRecruiterApplyModal(): boolean {
  return getVisibleZipRecruiterApplyModals().length > 0;
}

export function hasZipRecruiterAppliedConfirmation(): boolean {
  return collectVisibleZipRecruiterDialogRoots().some((modal) =>
    isZipRecruiterAppliedStateText(
      cleanText(modal.innerText || modal.textContent || "")
        .toLowerCase()
        .slice(0, 2500)
    )
  );
}

export function getVisibleZipRecruiterApplyModals(): HTMLElement[] {
  const matches: HTMLElement[] = [];
  for (const modal of collectVisibleZipRecruiterDialogRoots()) {
    if (isActiveZipRecruiterApplyModal(modal)) {
      matches.push(modal);
    }
  }

  return matches;
}

function collectVisibleZipRecruiterDialogRoots(): HTMLElement[] {
  return collectDeepMatches<HTMLElement>(ZIP_RECRUITER_DIALOG_SELECTOR).filter(
    (modal) => isElementVisible(modal)
  );
}

function isActiveZipRecruiterApplyModal(modal: HTMLElement): boolean {
  let text = cleanText(modal.innerText || modal.textContent || "")
    .toLowerCase()
    .slice(0, 2500);

  // Also extract text from shadow DOM
  for (const host of collectShadowHosts(modal)) {
    try {
      const shadowText = cleanText(
        host.shadowRoot?.textContent || ""
      ).toLowerCase();
      text += shadowText;
    } catch {
      continue;
    }
  }
  text = text.slice(0, 2500);

  if (!text || isZipRecruiterAppliedStateText(text)) {
    return false;
  }

  if (!ZIP_RECRUITER_ACTIVE_MODAL_TEXT_TOKENS.some((token) => text.includes(token))) {
    return false;
  }

  if (hasVisibleZipRecruiterEditableField(modal)) {
    return true;
  }

  return hasVisibleZipRecruiterApplyControl(modal);
}

function hasVisibleZipRecruiterEditableField(modal: HTMLElement): boolean {
  const fields = Array.from(
    modal.querySelectorAll<HTMLElement>("input, textarea, select")
  );

  // Also search in shadow DOM
  for (const host of collectShadowHosts(modal)) {
    try {
      const shadowFields = Array.from(
        host.shadowRoot?.querySelectorAll<HTMLElement>("input, textarea, select") ?? []
      );
      fields.push(...shadowFields);
    } catch {
      continue;
    }
  }

  return fields.some((field) => {
    if (!isElementVisible(field)) {
      return false;
    }

    if (field instanceof HTMLInputElement) {
      const type = field.type.toLowerCase();
      return !["hidden", "submit", "button", "reset", "image"].includes(type);
    }

    return true;
  });
}

function hasVisibleZipRecruiterApplyControl(modal: HTMLElement): boolean {
  const controls = Array.from(
    modal.querySelectorAll<HTMLElement>(
      "button, a[href], [role='button'], input[type='submit'], input[type='button']"
    )
  );

  // Also search in shadow DOM
  for (const host of collectShadowHosts(modal)) {
    try {
      const shadowControls = Array.from(
        host.shadowRoot?.querySelectorAll<HTMLElement>(
          "button, a[href], [role='button'], input[type='submit'], input[type='button']"
        ) ?? []
      );
      controls.push(...shadowControls);
    } catch {
      continue;
    }
  }

  return controls.some((control) => {
    if (!isElementVisible(control)) {
      return false;
    }

    const text = cleanText(
      [
        getActionText(control),
        control.getAttribute("aria-label"),
        control.getAttribute("title"),
        control.getAttribute("value"),
        control.getAttribute("data-testid"),
        control.getAttribute("data-qa"),
      ]
        .filter(Boolean)
        .join(" ")
    ).toLowerCase();

    if (
      !text ||
      isZipRecruiterAppliedStateText(text) ||
      [
        "tell us more",
        "support",
        "help",
        "close",
        "dismiss",
        "cancel",
        "back",
        "my jobs",
        "save",
        "share",
      ].some((token) => text.includes(token))
    ) {
      return false;
    }

    return /\b(apply|continue|next|review|start|proceed|resume|upload)\b/.test(
      text
    );
  });
}

function isZipRecruiterAppliedStateText(text: string): boolean {
  if (!text) {
    return false;
  }

  if (
    /\b(not applied|apply now|ready to apply|after you apply|before you apply|by pressing apply)\b/.test(
      text
    )
  ) {
    return false;
  }

  return ZIP_RECRUITER_APPLIED_STATE_PATTERNS.some((pattern) =>
    pattern.test(text)
  );
}

export function findProgressionAction(
  site?: SiteKey | null
): ProgressionAction | null {
  if (site === "ziprecruiter" && hasZipRecruiterAppliedConfirmation()) {
    return null;
  }

  const candidates = collectProgressionCandidates(site);

  let best:
    | {
        element: HTMLElement;
        score: number;
        url: string | null;
        text: string;
      }
    | undefined;

  for (const element of candidates) {
    if (
      !isElementVisible(element) ||
      element.hasAttribute("disabled") ||
      (element as HTMLButtonElement).disabled
    ) {
      continue;
    }

    const text = cleanText(
      getActionText(element) ||
        element.getAttribute("aria-label") ||
        element.getAttribute("title") ||
        ""
    );
    const metadata = getElementActionMetadata(element);
    const displayText = text || metadata;
    const lower = metadata.toLowerCase();
    const lowerText = text.toLowerCase();
    const hasNextInText = hasProgressionKeyword(lowerText, "next");
    const hasContinueInText = hasProgressionKeyword(lowerText, "continue");
    if (!lower) {
      continue;
    }

    if (isLikelyTechnologyReferenceAction(displayText, getMeaningfulProgressionUrl(element))) {
      continue;
    }

    if (
      /submit\s*(my\s*)?application/i.test(lowerText) ||
      /send\s*application/i.test(lowerText) ||
      /confirm\s*and\s*submit/i.test(lowerText) ||
      lowerText === "submit"
    ) {
      continue;
    }

    if (isBlockedProgressionCandidate(lower)) {
      continue;
    }

    let score = 0;

    if (/^next$/i.test(lowerText)) {
      score = 100;
    } else if (
      lowerText === "autofill with resume" ||
      lowerText === "auto fill with resume" ||
      lowerText === "auto-fill with resume"
    ) {
      score = 98;
    } else if (/^continue$/i.test(lowerText)) {
      score = 95;
    } else if (
      lowerText === "start my application" ||
      lowerText === "start application" ||
      lowerText === "start your application"
    ) {
      score = 94;
    } else if (
      lowerText.includes("start applying") ||
      lowerText.includes("start your application")
    ) {
      score = 92;
    } else if (lowerText === "next step" || lowerText === "next page") {
      score = 90;
    } else if (lowerText.includes("save and continue") || lowerText.includes("save & continue")) {
      score = 88;
    } else if (lowerText.includes("save and next") || lowerText.includes("save & next")) {
      score = 85;
    } else if (
      lowerText.includes("continue to company site") ||
      lowerText.includes("continue to company website") ||
      lowerText.includes("continue to employer site")
    ) {
      score = 84;
    } else if (lowerText.includes("continue to")) {
      score = 82;
    } else if (
      lowerText.includes("visit company site") ||
      lowerText.includes("visit company website")
    ) {
      score = 80;
    } else if (lowerText.includes("proceed")) {
      score = 78;
    } else if (
      lowerText.includes("review application") ||
      lowerText.includes("review my application") ||
      lowerText.includes("review details") ||
      lowerText.includes("review your details")
    ) {
      score = 75;
    } else if (
      lowerText === "review" ||
      lowerText === "review and continue"
    ) {
      score = 74;
    } else if (
      lowerText.includes("continue application") ||
      lowerText.includes("continue applying")
    ) {
      score = 73;
    } else if (hasNextInText && !lowerText.includes("submit")) {
      score = 70;
    } else if (hasContinueInText && !lowerText.includes("submit")) {
      score = 65;
    }

    if (!lowerText) {
      if (hasProgressionKeyword(lower, "next")) {
        score = Math.max(score, 88);
      } else if (hasProgressionKeyword(lower, "continue")) {
        score = Math.max(score, 84);
      } else if (
        lower.includes("start my application") ||
        lower.includes("start application")
      ) {
        score = Math.max(score, 90);
      } else if (hasProgressionKeyword(lower, "review")) {
        score = Math.max(score, 74);
      } else if (hasProgressionKeyword(lower, "proceed")) {
        score = Math.max(score, 72);
      }
    }

    const attrs = [
      element.getAttribute("data-test"),
      element.getAttribute("data-testid"),
      element.getAttribute("data-cy"),
      element.id,
      element.className,
    ]
      .join(" ")
      .toLowerCase();

    if (
      hasAnyProgressionKeyword(attrs, [
        "next",
        "continue",
        "proceed",
        "company",
        "review",
      ])
    ) {
      score += 15;
    }

    if (element.closest("form")) {
      score += 10;
    }
    if (isLikelyApplicationContext(element)) {
      score += 18;
    } else if (isLikelyNavigationChrome(element)) {
      score -= 35;
    }

    if (
      element instanceof HTMLButtonElement &&
      element.type.toLowerCase() === "submit"
    ) {
      score += 8;
    }

    if (site === "indeed") {
      if (
        attrs.includes("indeed") ||
        attrs.includes("ia-") ||
        attrs.includes("smartapply")
      ) {
        score += 8;
      }
    }

    if (site === "ziprecruiter") {
      if (
        attrs.includes("zip") ||
        attrs.includes("zipapply") ||
        attrs.includes("jobapply")
      ) {
        score += 8;
      }
    }

    if (site === "glassdoor") {
      if (
        attrs.includes("start") ||
        attrs.includes("apply") ||
        attrs.includes("continue")
      ) {
        score += 10;
      }
    }

    if (score < 50) {
      continue;
    }

    if (!best || score > best.score) {
      best = {
        element,
        score,
        url: getMeaningfulProgressionUrl(element),
        text: displayText,
      };
    }
  }

  if (!best) {
    return null;
  }

  return best.url
    ? {
        type: "navigate",
        url: best.url,
        description: best.text,
        text: best.text,
      }
    : {
        type: "click",
        element: best.element,
        description: best.text,
        text: best.text,
      };
}

function collectProgressionCandidates(
  site?: SiteKey | null
): HTMLElement[] {
  const selectors = getProgressionCandidateSelectors(site);

  if (site === "ziprecruiter") {
    const modalRoots = getVisibleZipRecruiterApplyModals();
    if (modalRoots.length > 0) {
      return collectActionCandidatesFromRoots(modalRoots, selectors);
    }
  }

  return collectDeepMatchesFromSelectors(selectors);
}

function getProgressionCandidateSelectors(
  site?: SiteKey | null
): string[] {
  const generic = [
    "button",
    "input[type='submit']",
    "input[type='button']",
    "a[href]",
    "a[role='button']",
    "[role='button']",
  ];
  const progressionKeywords = ["continue", "next", "review"];
  const progressionStartKeywords = ["continue", "next", "review", "start", "apply"];
  const monsterKeywords = [
    "continue",
    "next",
    "start",
    "review",
    "apply",
    "resume",
    "candidate",
  ];

  switch (site) {
    case "indeed":
      return [
        ...buildProgressionKeywordSelectors({
          dataTestIdKeywords: progressionKeywords,
          ariaLabelKeywords: progressionKeywords,
          idKeywords: progressionKeywords,
          classKeywords: progressionKeywords,
        }),
        ...generic,
      ];
    case "ziprecruiter":
      return [
        ...buildProgressionKeywordSelectors({
          dataTestIdKeywords: progressionKeywords,
          ariaLabelKeywords: progressionKeywords,
          idKeywords: ["continue", "next"],
          classKeywords: progressionKeywords,
        }),
        ...generic,
      ];
    case "glassdoor":
      return [
        ...buildProgressionKeywordSelectors({
          dataTestKeywords: progressionStartKeywords,
          ariaLabelKeywords: ["start", "continue", "next", "review"],
          classKeywords: ["start", "continue", "next", "review"],
        }),
        ...generic,
      ];
    case "dice":
      return [
        ...buildProgressionKeywordSelectors({
          dataTestIdKeywords: progressionStartKeywords,
          dataCyKeywords: progressionStartKeywords,
          ariaLabelKeywords: progressionStartKeywords,
          classKeywords: progressionStartKeywords,
        }),
        ...generic,
      ];
    case "monster":
      return [
        ...buildProgressionKeywordSelectors({
          dataTestIdKeywords: monsterKeywords,
          dataTestKeywords: monsterKeywords,
          ariaLabelKeywords: monsterKeywords,
          classKeywords: monsterKeywords,
        }),
        ...generic,
      ];
    default:
      return generic;
  }
}

function buildProgressionKeywordSelectors(options: {
  dataTestKeywords?: string[];
  dataTestIdKeywords?: string[];
  dataCyKeywords?: string[];
  ariaLabelKeywords?: string[];
  idKeywords?: string[];
  classKeywords?: string[];
}): string[] {
  return [
    ...buildProgressionAttributeSelectors("data-test", options.dataTestKeywords, true),
    ...buildProgressionAttributeSelectors(
      "data-testid",
      options.dataTestIdKeywords,
      true
    ),
    ...buildProgressionAttributeSelectors("data-cy", options.dataCyKeywords, true),
    ...buildProgressionAttributeSelectors(
      "aria-label",
      options.ariaLabelKeywords,
      true
    ),
    ...buildProgressionAttributeSelectors("id", options.idKeywords),
    ...buildProgressionAttributeSelectors("class", options.classKeywords),
  ];
}

function buildProgressionAttributeSelectors(
  attribute: string,
  keywords: string[] | undefined,
  caseInsensitive = false
): string[] {
  if (!keywords?.length) {
    return [];
  }

  const suffix = caseInsensitive ? " i" : "";
  const interactiveBases = [
    "button",
    "input[type='submit']",
    "input[type='button']",
    "a[href]",
    "a[role='button']",
    "[role='button']",
  ];

  return keywords.flatMap((keyword) =>
    interactiveBases.map(
      (base) => `${base}[${attribute}*='${keyword}'${suffix}]`
    )
  );
}

function hasAnyProgressionKeyword(
  value: string,
  keywords: string[]
): boolean {
  return keywords.some((keyword) => hasProgressionKeyword(value, keyword));
}

function hasProgressionKeyword(value: string, keyword: string): boolean {
  if (!value || !keyword) {
    return false;
  }

  const normalizedValue = value
    .toLowerCase()
    .replace(/\bnext\s*\.?\s*js\b/g, "nextjs");
  const escapedKeyword = escapeRegExp(keyword.toLowerCase());
  return new RegExp(`(?:^|[^a-z0-9])${escapedKeyword}(?:$|[^a-z0-9])`).test(
    normalizedValue
  );
}

function isBlockedProgressionCandidate(value: string): boolean {
  return (
    [
      "save for later",
      "sign in",
      "sign up",
      "log in",
      "back to jobs",
      "back to search",
      "tell us more",
    ].some((phrase) => value.includes(phrase)) ||
    hasAnyProgressionKeyword(value, [
      "back",
      "cancel",
      "close",
      "share",
      "register",
      "dismiss",
      "delete",
      "remove",
      "previous",
    ])
  );
}

function getMeaningfulProgressionUrl(
  element: HTMLElement
): string | null {
  const url = getNavigationUrl(element);
  if (!url) {
    return null;
  }

  const currentUrl = normalizeUrl(window.location.href);
  if (currentUrl && url === currentUrl) {
    return null;
  }

  // Embedded apply flows often expose internal step URLs through formaction or
  // data attributes. Clicking the control preserves the site's in-frame state,
  // while force-navigating the frame can trigger blocked beforeunload prompts
  // and break the application flow.
  if (shouldTreatInternalApplyNavigationAsClick(url, element)) {
    return null;
  }

  return url;
}

function shouldTreatInternalApplyNavigationAsClick(
  url: string,
  element: HTMLElement
): boolean {
  if (isExternalUrl(url)) {
    return false;
  }

  return (
    isLikelyApplicationContext(element) ||
    Boolean(element.closest("form, [role='dialog'], [aria-modal='true']")) ||
    isSameOriginInternalApplyStepNavigation(url)
  );
}

export function isSameOriginInternalApplyStepNavigation(url: string): boolean {
  const currentUrl = normalizeUrl(window.location.href);
  const targetUrl = normalizeUrl(url);

  if (!currentUrl || !targetUrl) {
    return false;
  }

  try {
    const current = new URL(currentUrl);
    const target = new URL(targetUrl);

    if (current.origin !== target.origin) {
      return false;
    }

    return (
      isKnownInternalApplyStepUrl(current) &&
      isKnownInternalApplyStepUrl(target)
    );
  } catch {
    return false;
  }
}

function isKnownInternalApplyStepUrl(url: URL): boolean {
  const lower = `${url.hostname}${url.pathname}${url.search}`.toLowerCase();

  return (
    lower.includes("indeedapply/form/") ||
    lower.includes("smartapply.indeed.com") ||
    lower.includes("zipapply") ||
    lower.includes("candidateexperience") ||
    lower.includes("jobapply")
  );
}

function getElementActionMetadata(element: HTMLElement): string {
  return cleanText(
    [
      getActionText(element),
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.getAttribute("data-test"),
      element.getAttribute("data-testid"),
      element.getAttribute("data-cy"),
      extractActionSemanticTokens(element.id),
      extractActionSemanticTokens(
        typeof element.className === "string" ? element.className : ""
      ),
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function extractActionSemanticTokens(value: string): string {
  if (!value) {
    return "";
  }

  const allowedTokens = new Set([
    "apply",
    "application",
    "continue",
    "next",
    "review",
    "proceed",
    "start",
    "begin",
    "resume",
    "candidate",
    "company",
    "employer",
    "external",
    "zipapply",
    "jobapply",
  ]);
  const tokens = value
    .replace(/\bnext\s*\.?\s*js\b/gi, "nextjs")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);

  return tokens
    .filter((token) => allowedTokens.has(token))
    .join(" ");
}

function isLikelyApplicationContext(element: HTMLElement): boolean {
  if (
    element.closest(
      "form, [role='dialog'], [aria-modal='true'], [data-testid*='apply'], [data-test*='apply'], [class*='apply'], [class*='application'], [class*='candidate']"
    )
  ) {
    return true;
  }

  const surroundingText = cleanText(
    element.closest("section, article, main, div")?.textContent || ""
  )
    .toLowerCase()
    .slice(0, 500);
  return /apply|application|resume|candidate/.test(surroundingText);
}

function isLikelyNavigationChrome(element: HTMLElement): boolean {
  return Boolean(element.closest("header, nav, footer, aside"));
}

export function findApplyAction(
  site: SiteKey | null,
  context: "job-page" | "follow-up"
): ApplyAction | null {
  if (site === "ziprecruiter" && hasZipRecruiterAppliedConfirmation()) {
    return null;
  }

  if (site === "ziprecruiter" && context === "job-page") {
    return findZipRecruiterApplyAction();
  }

  const selectors = getApplyCandidateSelectors(site);
  const scopedZipRecruiterElements =
    site === "ziprecruiter"
      ? collectZipRecruiterApplyCandidates(selectors)
      : [];
  const scopedBuiltInElements =
    site === "builtin" && context === "job-page"
      ? collectBuiltInCurrentJobApplyCandidates()
      : [];
  const elements =
    scopedBuiltInElements.length > 0
      ? scopedBuiltInElements
      : scopedZipRecruiterElements.length > 0
        ? scopedZipRecruiterElements
      : collectDeepMatchesFromSelectors(selectors);

  let best:
    | {
        element: HTMLElement;
        score: number;
        url: string | null;
        text: string;
      }
    | undefined;
  let bestDirect: ScoredApplyCandidate | undefined;

  for (const element of elements) {
    const actionElement = getClickableApplyElement(element);
    const text = getActionText(actionElement) || getActionText(element);
    const url = getNavigationUrl(actionElement) ?? getNavigationUrl(element);

    if (
      site === "builtin" &&
      context === "job-page" &&
      scopedBuiltInElements.length === 0 &&
      isBuiltInSecondaryApplyContext(actionElement)
    ) {
      continue;
    }

    if (
      site === "builtin" &&
      isBuiltInInternalJobDetailUrl(url) &&
      !hasBuiltInExternalApplySignal(text, actionElement)
    ) {
      continue;
    }

    const score = scoreApplyElement(text, url, actionElement, context);

    if (score < 30) {
      continue;
    }

    if (!best || score > best.score) {
      best = { element: actionElement, score, url, text };
    }
    if (
      context === "job-page" &&
      isDirectApplyActionCandidate(text, url) &&
      (!bestDirect || score > bestDirect.score)
    ) {
      bestDirect = { element: actionElement, score, url, text };
    }
  }

  if (context === "job-page") {
    best = choosePreferredJobPageAction(best, bestDirect);
  }

  if (!best) {
    return null;
  }

  if (best.url && shouldPreferApplyNavigation(best.url, best.text, site)) {
    if (
      context === "follow-up" &&
      shouldTreatInternalApplyNavigationAsClick(best.url, best.element)
    ) {
      return {
        type: "click",
        element: best.element,
        description: best.text || "the apply button",
      };
    }

    return {
      type: "navigate",
      url: best.url,
      description: describeApplyTarget(best.url, best.text),
    };
  }

  return {
    type: "click",
    element: best.element,
    description: best.text || "the apply button",
  };
}

function collectBuiltInCurrentJobApplyCandidates(): HTMLElement[] {
  const surfaces = collectDeepMatchesFromSelectors(
    getPrimaryCurrentJobSurfaceSelectors("builtin")
  ).filter((surface) => !surface.closest("aside, nav, header, footer"));
  const selectors = getSiteApplyCandidateSelectors("builtin");
  const results: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();

  for (const surface of surfaces) {
    for (const selector of selectors) {
      let matches: HTMLElement[];
      try {
        matches = Array.from(surface.querySelectorAll<HTMLElement>(selector));
      } catch {
        continue;
      }

      for (const match of matches) {
        if (seen.has(match) || isBuiltInSecondaryApplyContext(match)) {
          continue;
        }

        seen.add(match);
        results.push(match);
      }
    }
  }

  return results;
}

function isBuiltInInternalJobDetailUrl(url: string | null): boolean {
  if (!url) {
    return false;
  }

  try {
    const parsed = new URL(url, window.location.href);
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const path = parsed.pathname.toLowerCase();

    return (
      (hostname === "builtin.com" || hostname.endsWith(".builtin.com")) &&
      path.includes("/job/")
    );
  } catch {
    return false;
  }
}

function isBuiltInSecondaryApplyContext(element: HTMLElement): boolean {
  if (
    element.closest(
      "aside, [class*='related'], [class*='similar'], [class*='recommended'], [class*='more-jobs'], [class*='other-jobs'], [data-testid*='related' i], [data-test*='related' i]"
    )
  ) {
    return true;
  }

  const container = element.closest<HTMLElement>("section, article, div, aside");
  const containerText = cleanText(container?.textContent || "").toLowerCase();

  return (
    containerText.includes("related jobs") ||
    containerText.includes("similar jobs") ||
    containerText.includes("recommended jobs") ||
    containerText.includes("more jobs") ||
    containerText.includes("other jobs")
  );
}

function hasBuiltInExternalApplySignal(
  text: string,
  element: HTMLElement
): boolean {
  const lowerText = text.toLowerCase();
  const attrs = [
    element.getAttribute("aria-label"),
    element.getAttribute("title"),
    element.getAttribute("data-testid"),
    element.getAttribute("data-test"),
    element.className,
    element.id,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return (
    lowerText.includes("company site") ||
    lowerText.includes("employer site") ||
    lowerText.includes("apply externally") ||
    lowerText.includes("apply directly") ||
    lowerText.includes("external") ||
    attrs.includes("sticky-bar") ||
    attrs.includes("company-site") ||
    attrs.includes("employer-site") ||
    attrs.includes("external")
  );
}

export function isLikelyApplyUrl(url: string, site: SiteKey): boolean {
  if (isKnownBrokenApplyUrl(url)) {
    return false;
  }

  const lower = url.toLowerCase();
  let parsed: URL | null = null;

  try {
    parsed = new URL(url, window.location.href);
  } catch {
    parsed = null;
  }

  const hostname = parsed?.hostname.toLowerCase() ?? "";
  const pathAndQuery = `${parsed?.pathname.toLowerCase() ?? ""}${parsed?.search.toLowerCase() ?? ""}`;

  if (hostname.includes("greenhouse.io") && isGreenhouseApplicationUrl(pathAndQuery)) {
    return true;
  }

  if (site === "ziprecruiter" && isZipRecruiterCandidatePortalUrl(url)) {
    return false;
  }

  if (
    lower.includes("smartapply.indeed.com") ||
    lower.includes("indeedapply") ||
    lower.includes("zipapply") ||
    lower.includes("easyapply") ||
    lower.includes("easy-apply") ||
    lower.includes("/job-applications/") ||
    lower.includes("start-apply") ||
    lower.includes("/apply") ||
    lower.includes("application") ||
    lower.includes("candidateexperience") ||
    lower.includes("jobapply") ||
    lower.includes("job_app") ||
    lower.includes("applytojob")
  ) {
    return true;
  }

  if (
    site === "startup" ||
    site === "other_sites" ||
    site === "greenhouse" ||
    site === "builtin"
  ) {
    return includesAnyToken(lower, ATS_APPLICATION_URL_TOKENS);
  }

  try {
    return !new URL(url).hostname.toLowerCase().endsWith(getSiteRoot(site));
  } catch {
    return false;
  }
}

function isGreenhouseApplicationUrl(pathAndQuery: string): boolean {
  if (!pathAndQuery) {
    return false;
  }

  if (pathAndQuery.includes("/embed/job_app")) {
    return true;
  }

  if (
    pathAndQuery.includes("/apply") ||
    pathAndQuery.includes("/application") ||
    pathAndQuery.includes("job_application") ||
    pathAndQuery.includes("job-application") ||
    pathAndQuery.includes("job_app") ||
    pathAndQuery.includes("application_confirmation") ||
    pathAndQuery.includes("application_confirmation_token")
  ) {
    return true;
  }

  return false;
}

function isLikelyTechnologyReferenceAction(
  text: string,
  url: string | null | undefined
): boolean {
  const lower = cleanText(text).toLowerCase().trim();
  if (!lower) {
    return false;
  }

  if (
    /\b(apply|application|continue|next step|review|submit|start|proceed|company|employer|career|job|site)\b/.test(
      lower
    )
  ) {
    return false;
  }

  if (
    NON_ACTION_TECH_LABEL_PATTERN.test(lower) ||
    (lower.endsWith(".js") && lower.split(/\s+/).length <= 2)
  ) {
    return true;
  }

  return Boolean(url && NON_ACTION_TECH_URL_PATTERN.test(url.toLowerCase()));
}

export function isAlreadyOnApplyPage(site: SiteKey, url: string): boolean {
  return isLikelyApplyUrl(url, site);
}

function extractLikelyApplyUrl(element: HTMLElement): string | null {
  for (const attribute of Array.from(element.attributes)) {
    const value = attribute.value?.trim();
    if (!value) {
      continue;
    }

    if (/^https?:\/\//i.test(value) || value.startsWith("/")) {
      const normalized = normalizeUrl(value);
      if (
        normalized &&
        !isKnownBrokenApplyUrl(normalized) &&
        !isZipRecruiterCandidatePortalUrl(normalized) &&
        /apply|application|candidateexperience|jobapply|company|career/i.test(normalized)
      ) {
        return normalized;
      }
    }
  }

  return null;
}

function findExternalApplyUrlInDocument(): string | null {
  let best = findBestExternalApplyUrlFromSources(
    getApplyUrlAttributeSources()
  );
  if (best) {
    return best.url;
  }

  best = findBestExternalApplyUrlFromSources(getApplyUrlScriptSources());
  if (best) {
    return best.url;
  }

  best = findBestExternalApplyUrlFromSources(getApplyUrlMarkupSources());
  return best?.url ?? null;
}

function findBestExternalApplyUrlFromSources(
  sources: string[]
):
  | {
      url: string;
      score: number;
    }
  | undefined {
  let best:
    | {
        url: string;
        score: number;
      }
    | undefined;

  for (const source of sources) {
    const normalizedSource = source
      .replace(/\\u002f/gi, "/")
      .replace(/\\u003a/gi, ":")
      .replace(/\\u0026/gi, "&")
      .replace(/&#x2f;|&#47;/gi, "/")
      .replace(/&#x3a;|&#58;/gi, ":")
      .replace(/&amp;/gi, "&")
      .replace(/\\\//g, "/");

    for (const match of normalizedSource.matchAll(/https?:\/\/[^"'\\<>\s]+/gi)) {
      const rawUrl = match[0];
      const url = normalizeUrl(rawUrl);
      if (!url || isKnownBrokenApplyUrl(url) || !isExternalUrl(url)) {
        continue;
      }

      const matchIndex =
        typeof match.index === "number"
          ? match.index
          : normalizedSource.indexOf(rawUrl);
      const contextStart = Math.max(0, matchIndex - 120);
      const contextEnd = Math.min(
        normalizedSource.length,
        matchIndex + rawUrl.length + 120
      );
      const score = scoreExternalApplyUrl(
        url,
        normalizedSource.slice(contextStart, contextEnd)
      );
      if (score <= 0) {
        continue;
      }

      if (!best || score > best.score) {
        best = { url, score };
      }
    }
  }

  return best;
}

function getApplyUrlAttributeSources(): string[] {
  const sources: string[] = [];

  const elements = document.querySelectorAll<HTMLElement>(
    "a[href], button[data-href], button[data-url], [data-apply-url], [data-url], [onclick], form[action], iframe[src]"
  );

  for (const element of Array.from(elements)) {
    const source = [
      element.getAttribute("href"),
      element.getAttribute("data-href"),
      element.getAttribute("data-url"),
      element.getAttribute("data-apply-url"),
      element.getAttribute("onclick"),
      element.getAttribute("action"),
      element.getAttribute("src"),
    ]
      .filter(Boolean)
      .join(" ");

    const limited = limitApplyUrlSource(source);
    if (!limited) {
      continue;
    }

    sources.push(limited);
    if (sources.length >= MAX_APPLY_URL_SOURCE_COUNT) {
      break;
    }
  }

  return sources;
}

function getApplyUrlScriptSources(): string[] {
  const sources: string[] = [];

  const scripts = document.querySelectorAll<HTMLScriptElement>("script:not([src])");

  for (const script of Array.from(scripts)) {
    const limited = limitApplyUrlSource(script.textContent || "");
    if (!limited) {
      continue;
    }

    sources.push(limited);
    if (sources.length >= MAX_APPLY_URL_SOURCE_COUNT) {
      break;
    }
  }

  return sources;
}

function getApplyUrlMarkupSources(): string[] {
  const root = document.body ?? document.documentElement;
  if (!root) {
    return [];
  }

  const markup = root.innerHTML || "";
  if (!markup) {
    return [];
  }

  if (markup.length <= MAX_APPLY_URL_MARKUP_LENGTH) {
    const limited = limitApplyUrlSource(markup, MAX_APPLY_URL_MARKUP_LENGTH);
    return limited ? [limited] : [];
  }

  const tokenPattern = new RegExp(
    APPLY_URL_DISCOVERY_TOKENS.map(escapeRegExp).join("|"),
    "gi"
  );
  const snippets: string[] = [];
  const seenStarts: number[] = [];
  const duplicateDistance = Math.floor(APPLY_URL_MARKUP_SNIPPET_LENGTH / 3);

  for (const match of markup.matchAll(tokenPattern)) {
    const matchIndex =
      typeof match.index === "number" ? match.index : markup.indexOf(match[0]);
    const start = Math.max(
      0,
      matchIndex - Math.floor(APPLY_URL_MARKUP_SNIPPET_LENGTH / 2)
    );
    if (seenStarts.some((existingStart) => Math.abs(existingStart - start) < duplicateDistance)) {
      continue;
    }

    seenStarts.push(start);
    const limited = limitApplyUrlSource(
      markup.slice(start, start + APPLY_URL_MARKUP_SNIPPET_LENGTH),
      APPLY_URL_MARKUP_SNIPPET_LENGTH
    );
    if (!limited) {
      continue;
    }

    snippets.push(limited);
    if (snippets.length >= MAX_APPLY_URL_MARKUP_SNIPPET_COUNT) {
      break;
    }
  }

  if (snippets.length > 0) {
    return snippets;
  }

  const fallback = limitApplyUrlSource(
    markup.slice(0, MAX_APPLY_URL_MARKUP_LENGTH),
    MAX_APPLY_URL_MARKUP_LENGTH
  );
  return fallback ? [fallback] : [];
}

function limitApplyUrlSource(
  source: string | null | undefined,
  maxLength = MAX_APPLY_URL_SOURCE_LENGTH
): string | null {
  if (!source) {
    return null;
  }

  const trimmed = source.trim();
  if (!trimmed) {
    return null;
  }

  const lower = trimmed.toLowerCase();
  if (!APPLY_URL_DISCOVERY_TOKENS.some((token) => lower.includes(token))) {
    return null;
  }

  return trimmed.slice(0, maxLength);
}

function hasApplyLikeExternalUrlCue(url: string): boolean {
  const lower = url.toLowerCase();

  return (
    includesAnyToken(lower, ATS_APPLICATION_URL_TOKENS) ||
    includesAnyToken(lower, ATS_SCORING_URL_TOKENS) ||
    /\/(apply|application|candidate|jobapply|jobs?|openings?|positions?|careers?)\b|[?&](gh_jid|job_id|jobid|requisitionid|rid|job)=/i.test(
      lower
    )
  );
}

function scoreExternalApplyUrl(url: string, sourceContext = ""): number {
  const lower = url.toLowerCase();
  const lowerContext = sourceContext.toLowerCase();

  if (
    /\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|woff2?|ttf|eot|mp4|webm|mp3|wav|pdf)(?:[?#].*)?$/.test(
      lower
    )
  ) {
    return -1;
  }

  if (
    /(?:^|[/?#._-])(logo|image|images|img|icon|icons|asset|assets|media|banner|thumbnail|thumb|avatar|photo|photos|favicon)(?:[/?#._-]|$)/i.test(
      lower
    )
  ) {
    return -1;
  }

  if (
    /<(?:img|source)\b|srcset\s*=|background-image|og:image|twitter:image|itemprop\s*=\s*["']image["']/i.test(
      lowerContext
    )
  ) {
    return -1;
  }

  if (
    [
      "facebook.com",
      "linkedin.com",
      "twitter.com",
      "instagram.com",
      "youtube.com",
      "tiktok.com",
      "doubleclick.net",
      "googletagmanager.com",
      "google-analytics.com",
      "privacy",
      "terms",
      "cookie",
      "help",
      "support",
    ].some((token) => lower.includes(token))
  ) {
    return -1;
  }

  let score = 0;
  const hasApplyCue = hasApplyLikeExternalUrlCue(url);
  const hasApplyContextCue = includesAnyToken(lowerContext, [
    "apply",
    "application",
    "candidate",
    "resume",
    "career",
    "job",
  ]);
  const indeedHosted = lower.includes("indeed.com");

  if (indeedHosted && !isLikelyApplyUrl(url, "indeed")) {
    return -1;
  }

  if (includesAnyToken(lower, KNOWN_ATS_HOST_TOKENS)) {
    score += hasApplyCue ? 120 : hasApplyContextCue ? 95 : 20;
  }

  if (indeedHosted) {
    score += hasApplyCue ? 120 : 30;
  }

  if (includesAnyToken(lower, ATS_SCORING_URL_TOKENS)) {
    score += 55;
  }

  if (includesAnyToken(lowerContext, ["apply", "application", "career", "job"])) {
    score += 12;
  }

  if (!hasApplyCue && score < 60) {
    return -1;
  }

  return score;
}

function scoreApplyElement(
  text: string,
  url: string | null,
  element: HTMLElement,
  context: "job-page" | "follow-up"
): number {
  if (isKnownBrokenApplyUrl(url)) {
    return -1;
  }

  if (isLikelyTechnologyReferenceAction(text, url)) {
    return -1;
  }

  if (isLikelyInformationalPageUrl(url)) {
    return -1;
  }

  if (!isElementVisible(element) || (element as HTMLButtonElement).disabled) {
    return -1;
  }

  const lower = text.toLowerCase().trim();
  const lowerUrl = url?.toLowerCase() ?? "";
  const attrs = [
    element.getAttribute("data-test"),
    element.getAttribute("data-testid"),
    element.getAttribute("data-cy"),
    element.getAttribute("data-qa"),
    element.getAttribute("data-track"),
    element.getAttribute("aria-label"),
    element.getAttribute("title"),
    element.id,
    element.className,
    element.tagName,
  ]
    .join(" ")
    .toLowerCase();

  if (
    /submit\s*(my\s*)?application/i.test(lower) ||
    /send\s*application/i.test(lower) ||
    /confirm\s*and\s*submit/i.test(lower)
  ) {
    return -1;
  }

  const blocked = [
    "save for later",
    "share this",
    "sign in",
    "sign up",
    "register",
    "report",
    "email this",
    "copy link",
    "compare",
    "job alert",
    "subscribe",
    "learn more",
    "dismiss",
    "close",
  ];
  if (blocked.some((value) => lower.includes(value)) || isLegalOrPolicyText(lower)) {
    return -1;
  }
  if (
    isLikelyNavigationChrome(element) &&
    !lower.includes("apply") &&
    !lower.includes("application")
  ) {
    return -1;
  }

  const hasActionSignal =
    /apply|application|continue|next|review|start|begin|proceed|easy|quick|1-click|1 click/.test(
      lower
    ) ||
    /apply|application|continue|next|review|start|begin|proceed|easy|quick|zipapply|jobapply|one-click/.test(
      attrs
    ) ||
    includesAnyToken(lowerUrl, ATS_APPLICATION_URL_TOKENS) ||
    /\/apply\/|zipapply|jobapply|candidateexperience|indeedapply|smartapply/.test(
      lowerUrl
    );

  if (!hasActionSignal) {
    return -1;
  }

  let score = 0;

  if (lowerUrl.includes("smartapply.indeed.com")) score += 100;
  if (lowerUrl.includes("indeedapply")) score += 95;
  if (lowerUrl.includes("zipapply")) score += 90;
  if (lower === "application" && /\/application(?:[/?#]|$)/.test(lowerUrl)) {
    score += 84;
  }

  if (lower === "apply now") score += 92;
  if (lower === "apply") score += 86;
  if (lower === "easy apply") score += 85;
  if (lower === "indeed apply") score += 85;
  if (lower === "quick apply") score += 80;
  if (lower === "1-click apply") score += 80;

  if (lower.includes("apply on company")) score += 92;
  if (lower.includes("apply on employer")) score += 90;
  if (lower.includes("apply externally")) score += 88;
  if (lower.includes("continue to company")) score += 86;
  if (lower.includes("company website to apply")) score += 86;
  if (lower.includes("apply directly")) score += 86;
  if (lower.includes("apply on the company")) score += 85;
  if (lower.includes("apply on external")) score += 84;
  if (lower.includes("apply through")) score += 82;

  if (lower.includes("apply now")) score += 80;
  if (lower.includes("start application")) score += 72;
  if (lower.includes("begin application")) score += 72;
  if (lower.includes("view application")) score += 70;
  if (lower.includes("continue to application")) score += 68;
  if (lower.includes("continue application")) score += 65;
  if (lower.includes("apply for this")) score += 75;
  if (lower.includes("apply to this")) score += 75;

  if (score === 0 && lower.includes("apply")) score += 50;
  if (score === 0 && lower === "application" && lowerUrl.includes("/application")) {
    score += 48;
  }

  if (context === "follow-up") {
    if (lower.includes("continue") && !lower.includes("submit")) score += 40;
    if (lower.includes("next") && !lower.includes("submit")) score += 35;
    if (lower.includes("proceed")) score += 35;
  }

  if (score === 0 && lowerUrl.includes("/apply")) score += 60;
  if (score === 0 && lowerUrl.includes("application")) score += 50;
  if (score === 0 && includesAnyToken(lowerUrl, ATS_APPLICATION_URL_TOKENS)) {
    score += 55;
  }

  if (url && isExternalUrl(url)) score += 20;
  if (attrs.includes("apply")) score += 30;
  if (attrs.includes("application")) score += 20;
  if (attrs.includes("quick apply") || attrs.includes("easy apply")) score += 20;
  if (attrs.includes("apply-button-wc")) score += 30;
  if (attrs.includes("svx_applybutton") || attrs.includes("applybutton")) score += 35;
  if (attrs.includes("company") || attrs.includes("external")) score += 20;
  if (isLikelyApplicationContext(element)) score += 12;
  if (isLikelyNavigationChrome(element)) score -= 20;

  return score;
}

function getApplyCandidateSelectors(site: SiteKey | null): string[] {
  const generic = [
    "a[href*='apply']",
    "a[href*='application']",
    "a[href]",
    "a[role='button']",
    "button",
    "input[type='submit']",
    "input[type='button']",
    "[aria-label*='apply' i]",
    "[title*='apply' i]",
    "[data-test*='apply' i]",
    "[data-test*='application' i]",
    "[data-testid*='apply']",
    "[data-automation*='apply']",
    "[class*='apply']",
    "[id*='apply']",
    "form button",
    "form a[href]",
  ];
  const siteSelectors = getSiteApplyCandidateSelectors(site);
  return siteSelectors.length > 0 ? siteSelectors : generic;
}

function describeApplyTarget(url: string, text: string): string {
  if (url.toLowerCase().includes("smartapply.indeed.com")) {
    return "the Indeed apply page";
  }

  if (/zipapply|jobapply|candidateexperience|indeedapply|smartapply|\/apply\b/i.test(url)) {
    return "the apply page";
  }

  if (isExternalUrl(url) || text.toLowerCase().includes("company site")) {
    return "the company career page";
  }

  return text || "the apply page";
}

export function shouldPreferApplyNavigation(
  url: string,
  text: string,
  site: SiteKey | null
): boolean {
  if (isKnownBrokenApplyUrl(url)) {
    return false;
  }

  if (isLikelyInformationalPageUrl(url)) {
    return false;
  }

  const lowerText = text.toLowerCase();
  if (
    lowerText.includes("company site") ||
    lowerText.includes("employer site") ||
    lowerText.includes("apply externally") ||
    lowerText.includes("apply directly") ||
    lowerText.includes("apply on external") ||
    lowerText.includes("apply through")
  ) {
    return true;
  }

  if (isExternalUrl(url)) {
    return true;
  }

  if (!site) {
    return /apply|application|candidate|jobapply|zipapply|indeedapply/i.test(url);
  }

  return isLikelyApplyUrl(url, site);
}

function getSiteRoot(site: SiteKey): string {
  switch (site) {
    case "indeed":
      return "indeed.com";
    case "ziprecruiter":
      return "ziprecruiter.com";
    case "dice":
      return "dice.com";
    case "monster":
      return "monster.com";
    case "glassdoor":
      return "glassdoor.com";
    case "greenhouse":
      return "greenhouse.io";
    case "builtin":
      return "builtin.com";
    case "startup":
    case "other_sites":
      return window.location.hostname.toLowerCase();
  }
}
