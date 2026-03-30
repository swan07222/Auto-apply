import {
  DATE_POSTED_WINDOW_LABELS,
  DatePostedWindow,
  ResumeKind,
  SiteKey,
  getBuiltInDaysSinceUpdatedValue,
  getJobDedupKey,
  getNearestSupportedDatePostedDays,
  getSiteLabel,
  sleep,
} from "../shared";
import {
  collectDeepMatches,
  getActionText,
  getNavigationUrl,
  isElementInteractive,
  isElementVisible,
  normalizeUrl,
  performClickAction,
} from "./dom";
import {
  collectJobDetailCandidates,
  collectMonsterEmbeddedCandidates,
  pickRelevantJobUrls,
  shouldFinishJobResultScan,
} from "./jobSearch";
import {
  CAREER_LISTING_TEXT_PATTERNS,
  CAREER_LISTING_URL_PATTERNS,
  PRIORITY_CAREER_LISTING_TEXT_PATTERNS,
  PRIORITY_CAREER_LISTING_URL_PATTERNS,
  includesAnyToken,
} from "./sitePatterns";
import {
  getCareerSiteJobLinkSelectors,
  getSiteJobResultCollectionTargetCount,
  getSiteResultSurfaceSettleMs,
} from "./sites";
import { cleanText } from "./text";

type SearchResultsPageAction = {
  element: HTMLElement;
  navUrl: string | null;
  score: number;
  text: string;
};

const NEXT_PAGE_ARROW_LABELS = new Set([
  ">",
  "\u00bb",
  "\u203a",
  "\u2192",
  "\u27e9",
  "\u276f",
]);
const NEXT_PAGE_ADVANCE_TIMEOUT_MS = 6_000;
const NEXT_PAGE_ADVANCE_POLL_MS = 200;
const NEXT_PAGE_URL_CHANGE_GRACE_MS = 1_500;

export type SearchResultsAdvanceResult =
  | "advanced"
  | "navigating"
  | "none";

type WaitForJobDetailUrlsOptions = {
  site: SiteKey;
  datePostedWindow: DatePostedWindow;
  targetCount?: number;
  detectedSite: SiteKey | null;
  resumeKind?: ResumeKind;
  searchKeywords?: string[];
  candidateCountry?: string;
  label?: string;
  onOpenListingsSurface?: (message: string) => void;
};

export async function scrollPageForLazyContent(): Promise<void> {
  let previousHeight = 0;

  for (let step = 0; step < 10; step += 1) {
    const totalHeight = Math.max(
      document.body.scrollHeight,
      document.documentElement?.scrollHeight ?? 0
    );
    const viewportHeight = Math.max(window.innerHeight, 1);
    const target = Math.min(totalHeight, viewportHeight * (step + 1));
    setWindowScrollTop(target);
    await waitForDomSettle(1_000, 350);

    if (totalHeight <= previousHeight && step >= 2) {
      break;
    }
    previousHeight = totalHeight;
  }

  setWindowScrollTop(0);
  await waitForDomSettle(700, 250);
}

export function getJobResultCollectionTargetCount(
  site: SiteKey,
  jobPageLimit: number
): number {
  return getSiteJobResultCollectionTargetCount(site, jobPageLimit);
}

export async function waitForJobDetailUrls({
  site,
  datePostedWindow,
  targetCount = 1,
  detectedSite,
  resumeKind,
  searchKeywords = [],
  candidateCountry,
  label,
  onOpenListingsSurface,
}: WaitForJobDetailUrlsOptions): Promise<string[]> {
  const isMyGreenhousePortal = site === "greenhouse" && isMyGreenhousePortalHost();
  const isCareerSite =
    site === "startup" ||
    site === "other_sites" ||
    site === "greenhouse" ||
    site === "builtin";
  const shouldTryCareerSurfaceRecovery =
    isCareerSite &&
    site !== "greenhouse" &&
    site !== "builtin" &&
    !isMyGreenhousePortal;
  const needsAggressiveScan =
    isCareerSite ||
    site === "monster" ||
    site === "indeed" ||
    site === "dice" ||
    site === "ziprecruiter" ||
    site === "glassdoor";
  let careerSurfaceAttempts = 0;
  let builtInSearchRecoveryAttempts = 0;
  const desiredCount = Math.max(1, Math.floor(targetCount));
  let bestUrls: string[] = [];
  let previousSignature = "";
  let stablePasses = 0;
  let monsterEmbeddedAttempts = 0;

  const maxAttempts = needsAggressiveScan ? 50 : 35;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (
      site === "builtin" &&
      builtInSearchRecoveryAttempts < 2 &&
      (attempt === 0 || attempt === 8 || attempt === 18)
    ) {
      const restoredBuiltInSearch = await tryRestoreBuiltInKeywordSearch({
        datePostedWindow,
        searchKeywords,
        label,
        onOpenListingsSurface,
      });
      if (restoredBuiltInSearch) {
        builtInSearchRecoveryAttempts += 1;
        await waitForDomSettle(2_400, 500);
      }
    }

    const candidates = collectJobDetailCandidates(site);
    const urls = Array.from(
      new Set(
        pickRelevantJobUrls(
          candidates,
          detectedSite,
          resumeKind,
          datePostedWindow,
          searchKeywords,
          window.location.href,
          candidateCountry
        )
      )
    );

    const combinedUrls = mergeJobUrlLists(bestUrls, urls);
    if (combinedUrls.length >= bestUrls.length) {
      bestUrls = combinedUrls;
    }

    if (
      site === "monster" &&
      bestUrls.length < desiredCount &&
      monsterEmbeddedAttempts < 2 &&
      (attempt === 4 || attempt === 12)
    ) {
      monsterEmbeddedAttempts += 1;
      const embeddedUrls = await collectMonsterEmbeddedUrls({
        detectedSite,
        resumeKind,
        datePostedWindow,
        searchKeywords,
        candidateCountry,
      });

      const mergedUrls = mergeJobUrlLists(bestUrls, urls, embeddedUrls);
      if (mergedUrls.length > bestUrls.length) {
        bestUrls = mergedUrls;
      }
    }

    const signature = urls.slice(0, Math.max(desiredCount, 8)).join("|");
    if (signature && signature === previousSignature) {
      stablePasses += 1;
    } else {
      stablePasses = 0;
      previousSignature = signature;
    }

    if (
      shouldFinishJobResultScan(
        bestUrls.length,
        desiredCount,
        stablePasses,
        attempt,
        site
      )
    ) {
      return bestUrls;
    }

    if (isCareerSite) {
      if (
        shouldTryCareerSurfaceRecovery &&
        careerSurfaceAttempts < 2 &&
        (attempt === 8 || attempt === 18)
      ) {
        careerSurfaceAttempts += 1;
        const openedCareerSurface = await tryOpenCareerListingsSurface({
          site,
          datePostedWindow,
          detectedSite,
          resumeKind,
          searchKeywords,
          candidateCountry,
          label,
          onOpenListingsSurface,
        });
        if (openedCareerSurface) {
          await waitForDomSettle(2_400, 500);
        }
      }

      if (attempt % 5 === 0) {
        advanceCareerSiteResultsSurface(site, attempt);
      } else if (attempt % 5 === 1) {
        advanceCareerSiteResultsSurface(site, attempt);
      } else if (attempt % 5 === 2) {
        advanceCareerSiteResultsSurface(site, attempt);
      } else if (attempt % 5 === 3) {
        advanceCareerSiteResultsSurface(site, attempt);
      } else {
        advanceCareerSiteResultsSurface(site, attempt);
      }

      if (attempt === 10 || attempt === 20 || attempt === 30) {
        tryClickLoadMoreButton();
      }
    } else if (site === "monster") {
      advanceMonsterResultsSurface(attempt);

      if (
        attempt === 8 ||
        attempt === 16 ||
        attempt === 24 ||
        attempt === 32 ||
        attempt === 40
      ) {
        tryClickLoadMoreButton();
      }
    } else if (
      site === "indeed" ||
      site === "dice" ||
      site === "ziprecruiter" ||
      site === "glassdoor"
    ) {
      if (attempt % 4 === 0) {
        setWindowScrollTop(document.body.scrollHeight);
      } else if (attempt % 4 === 1) {
        setWindowScrollTop(0);
      } else if (attempt % 4 === 2) {
        setWindowScrollTop(document.body.scrollHeight / 2);
      } else {
        setWindowScrollTop(document.body.scrollHeight / 3);
      }

      if (
        attempt === 6 ||
        attempt === 12 ||
        attempt === 18 ||
        attempt === 24 ||
        attempt === 32
      ) {
        tryClickLoadMoreButton();
      }
    } else if (
      attempt === 5 ||
      attempt === 10 ||
      attempt === 15 ||
      attempt === 20 ||
      attempt === 25
    ) {
      setWindowScrollTop(document.body.scrollHeight);
    }

    await waitForResultSurfaceSettle(site);
  }

  return bestUrls;
}

export async function tryApplySupportedResultsDateFilter(
  site: SiteKey,
  datePostedWindow: DatePostedWindow
): Promise<boolean> {
  if (datePostedWindow === "any") {
    return false;
  }

  if (site === "ziprecruiter") {
    return tryApplyZipRecruiterPostedDateFilter(datePostedWindow);
  }

  if (site === "monster") {
    return tryApplyMonsterPostedDateFilter(datePostedWindow);
  }

  return false;
}

function mergeJobUrlLists(...lists: string[][]): string[] {
  const merged: string[] = [];
  const seenKeys = new Set<string>();

  for (const list of lists) {
    for (const url of list) {
      const trimmedUrl = url.trim();
      const key = getJobDedupKey(trimmedUrl) || trimmedUrl.toLowerCase();

      if (!trimmedUrl || seenKeys.has(key)) {
        continue;
      }

      seenKeys.add(key);
      merged.push(trimmedUrl);
    }
  }

  return merged;
}

async function waitForResultSurfaceSettle(site: SiteKey): Promise<void> {
  await waitForDomSettle(getSiteResultSurfaceSettleMs(site), 350);
}

async function tryApplyZipRecruiterPostedDateFilter(
  datePostedWindow: DatePostedWindow
): Promise<boolean> {
  const directOption = findZipRecruiterDateFilterOption(datePostedWindow);
  if (directOption && activateZipRecruiterDateFilterOption(directOption, datePostedWindow)) {
    await sleep(900);
    return true;
  }

  const launchers = findZipRecruiterDateFilterLaunchers();
  for (const launcher of launchers.slice(0, 3)) {
    if (!isElementInteractive(launcher)) {
      continue;
    }

    performClickAction(launcher);
    await sleep(700);

    const option = findZipRecruiterDateFilterOption(datePostedWindow);
    if (!option) {
      continue;
    }

    if (activateZipRecruiterDateFilterOption(option, datePostedWindow)) {
      await sleep(900);
      return true;
    }
  }

  return false;
}

async function tryApplyMonsterPostedDateFilter(
  datePostedWindow: DatePostedWindow
): Promise<boolean> {
  const select = findMonsterDateFilterControl();
  if (!select || !activateMonsterDateFilterOption(select, datePostedWindow)) {
    return false;
  }

  await sleep(900);
  return true;
}

function findMonsterDateFilterControl(): HTMLSelectElement | null {
  const targetLabels = getMonsterDateFilterTargetLabels("30d");
  for (const select of Array.from(document.querySelectorAll<HTMLSelectElement>("select"))) {
    if (!isElementVisible(select)) {
      continue;
    }

    const optionTexts = Array.from(select.options).map((option) =>
      cleanText(option.textContent || "").toLowerCase()
    );
    const hasAllDates = optionTexts.some((text) => text === "all dates");
    const hasDateOptions = targetLabels.some((label) =>
      optionTexts.some((text) => text === label || text.includes(label))
    );

    if (hasAllDates && hasDateOptions) {
      return select;
    }
  }

  return null;
}

function activateMonsterDateFilterOption(
  select: HTMLSelectElement,
  datePostedWindow: DatePostedWindow
): boolean {
  const labels = getMonsterDateFilterTargetLabels(datePostedWindow);
  const optionIndex = Array.from(select.options).findIndex((option) => {
    const text = cleanText(option.textContent || "").toLowerCase();
    return labels.some((label) => text === label || text.includes(label));
  });

  if (optionIndex < 0) {
    return false;
  }

  select.selectedIndex = optionIndex;
  select.dispatchEvent(new Event("input", { bubbles: true }));
  select.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

function findZipRecruiterDateFilterLaunchers(): HTMLElement[] {
  const launchers: Array<{ element: HTMLElement; score: number }> = [];
  const seen = new Set<HTMLElement>();

  for (const element of collectDeepMatches<HTMLElement>(
    "button, [role='button'], summary, a[href], label, div[tabindex], span[tabindex]"
  )) {
    if (!isElementVisible(element)) {
      continue;
    }

    const text = cleanText(
      [
        getActionText(element),
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        element.getAttribute("data-testid"),
        element.getAttribute("data-qa"),
      ]
        .filter(Boolean)
        .join(" ")
    ).toLowerCase();

    if (!text) {
      continue;
    }

    if (
      text.includes("date posted") ||
      text.includes("posted date") ||
      text === "date" ||
      text.startsWith("date ")
    ) {
      if (!seen.has(element)) {
        seen.add(element);
        launchers.push({
          element,
          score:
            (text.includes("date posted") || text.includes("posted date") ? 40 : 0) +
            (element.getAttribute("aria-expanded") !== null ? 8 : 0),
        });
      }
    }
  }

  return launchers
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.element);
}

function findZipRecruiterDateFilterOption(
  datePostedWindow: DatePostedWindow
): HTMLElement | HTMLSelectElement | null {
  const targetLabels = getZipRecruiterDateFilterTargetLabels(datePostedWindow);
  const scored: Array<{ element: HTMLElement; score: number }> = [];
  const seen = new Set<HTMLElement>();

  for (const element of collectDeepMatches<HTMLElement>(
    "button, [role='button'], [role='option'], a[href], label, li, div, span"
  )) {
    if (!isElementVisible(element)) {
      continue;
    }

    const text = cleanText(
      [
        getActionText(element),
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
      ]
        .filter(Boolean)
        .join(" ")
    ).toLowerCase();
    if (!text) {
      continue;
    }

    const labelIndex = targetLabels.findIndex((label) => text === label || text.includes(label));
    if (labelIndex < 0) {
      continue;
    }

    if (!seen.has(element)) {
      seen.add(element);
      scored.push({
        element,
        score:
          (text === targetLabels[labelIndex] ? 30 : 0) +
          (element.matches("button, [role='button'], [role='option'], label") ? 8 : 0),
      });
    }
  }

  const bestElement = scored
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.element)[0];
  if (bestElement) {
    return bestElement;
  }

  for (const select of Array.from(document.querySelectorAll<HTMLSelectElement>("select"))) {
    if (!isElementVisible(select)) {
      continue;
    }

    const option = Array.from(select.options).find((entry) => {
      const text = cleanText(entry.textContent || "").toLowerCase();
      return targetLabels.some((label) => text === label || text.includes(label));
    });

    if (option) {
      return select;
    }
  }

  return null;
}

function activateZipRecruiterDateFilterOption(
  target: HTMLElement | HTMLSelectElement,
  datePostedWindow: DatePostedWindow
): boolean {
  if (target instanceof HTMLSelectElement) {
    const labels = getZipRecruiterDateFilterTargetLabels(datePostedWindow);
    const option = Array.from(target.options).find((entry) => {
      const text = cleanText(entry.textContent || "").toLowerCase();
      return labels.some((label) => text === label || text.includes(label));
    });
    if (!option?.value) {
      return false;
    }

    target.value = option.value;
    target.dispatchEvent(new Event("input", { bubbles: true }));
    target.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  const labelInput = target.matches("label")
    ? target.querySelector<HTMLInputElement>("input")
    : null;
  if (labelInput && !labelInput.checked) {
    labelInput.checked = true;
    labelInput.dispatchEvent(new Event("input", { bubbles: true }));
    labelInput.dispatchEvent(new Event("change", { bubbles: true }));
  }

  if (!isElementInteractive(target) && !target.matches("label")) {
    return false;
  }

  performClickAction(target);
  return true;
}

function getZipRecruiterDateFilterTargetLabels(
  datePostedWindow: DatePostedWindow
): string[] {
  const bucket = getNearestSupportedDatePostedDays(
    datePostedWindow,
    [1, 5, 10, 30],
    { fallbackToMax: true }
  );

  switch (bucket) {
    case 1:
      return ["within 1 day", "past 24 hours", "last 24 hours", "24 hours"];
    case 5:
      return ["within 5 days", "past 5 days", "last 5 days", "5 days"];
    case 10:
      return ["within 10 days", "past 10 days", "last 10 days", "10 days"];
    case 30:
      return [
        "within 30 days",
        "past 30 days",
        "last 30 days",
        "30 days",
        "past month",
        "last month",
      ];
    default:
      return [];
  }
}

function getMonsterDateFilterTargetLabels(
  datePostedWindow: DatePostedWindow
): string[] {
  const bucket = getNearestSupportedDatePostedDays(
    datePostedWindow,
    [1, 2, 7, 14, 30],
    { fallbackToMax: true }
  );

  switch (bucket) {
    case 1:
      return ["today", "last 24 hours", "within 1 day"];
    case 2:
      return ["last 2 days", "past 2 days", "within 2 days"];
    case 7:
      return ["last week", "past week", "last 7 days", "past 7 days"];
    case 14:
      return ["last 2 weeks", "past 2 weeks", "last 14 days", "past 14 days"];
    case 30:
      return ["last month", "past month", "last 30 days", "past 30 days"];
    default:
      return [];
  }
}

function advanceCareerSiteResultsSurface(
  site: "startup" | "other_sites" | "greenhouse" | "builtin",
  attempt: number
): void {
  const container = findCareerSiteScrollableResultsContainer(site);

  if (container) {
    const maxScrollTop = Math.max(container.scrollHeight - container.clientHeight, 0);
    const stride = Math.max(Math.round(container.clientHeight * 0.9), 280);
    const phase = attempt % 5;
    let nextTop = container.scrollTop;

    if (maxScrollTop > 0) {
      if (phase === 0) {
        nextTop = Math.min(maxScrollTop, container.scrollTop + stride);
      } else if (phase === 1) {
        nextTop = Math.min(maxScrollTop, container.scrollTop + stride);
      } else if (phase === 2) {
        nextTop = 0;
      } else if (phase === 3) {
        nextTop = Math.min(maxScrollTop, Math.round(maxScrollTop / 2));
      } else {
        nextTop = maxScrollTop;
      }

      if (nextTop !== container.scrollTop) {
        setElementScrollTop(container, nextTop);
        container.dispatchEvent(new Event("scroll", { bubbles: true }));
      }
      return;
    }
  }

  const pageHeight = Math.max(
    document.body.scrollHeight,
    document.documentElement?.scrollHeight ?? 0
  );
  const phase = attempt % 5;

  if (phase === 0) {
    setWindowScrollTop(pageHeight);
  } else if (phase === 1) {
    setWindowScrollTop(pageHeight / 2);
  } else if (phase === 2) {
    setWindowScrollTop(0);
  } else if (phase === 3) {
    setWindowScrollTop(pageHeight / 3);
  } else {
    setWindowScrollTop((pageHeight * 2) / 3);
  }
}

function advanceMonsterResultsSurface(attempt: number): void {
  const rail = findMonsterScrollableResultsRail();

  if (rail) {
    const maxScrollTop = Math.max(rail.scrollHeight - rail.clientHeight, 0);
    const stride = Math.max(Math.round(rail.clientHeight * 0.9), 280);
    const phase = attempt % 6;
    let nextTop = rail.scrollTop;

    if (maxScrollTop > 0) {
      if (phase === 0) {
        nextTop = Math.min(maxScrollTop, rail.scrollTop + stride);
      } else if (phase === 1) {
        nextTop = Math.min(maxScrollTop, rail.scrollTop + stride);
      } else if (phase === 2) {
        nextTop = Math.min(maxScrollTop, rail.scrollTop + Math.round(stride / 2));
      } else if (phase === 3) {
        nextTop = maxScrollTop;
      } else if (phase === 4) {
        nextTop = Math.max(0, Math.round(maxScrollTop / 2));
      } else {
        nextTop = 0;
      }

      if (nextTop !== rail.scrollTop) {
        setElementScrollTop(rail, nextTop);
        rail.dispatchEvent(new Event("scroll", { bubbles: true }));
      }
    }
    return;
  }

  const pageHeight = Math.max(
    document.body.scrollHeight,
    document.documentElement?.scrollHeight ?? 0
  );
  const pagePhase = attempt % 4;

  if (pagePhase === 0) {
    setWindowScrollTop(pageHeight / 3);
  } else if (pagePhase === 1) {
    setWindowScrollTop(pageHeight);
  } else if (pagePhase === 2) {
    setWindowScrollTop(pageHeight / 2);
  } else {
    setWindowScrollTop(0);
  }
}

function findCareerSiteScrollableResultsContainer(
  site: "startup" | "other_sites" | "greenhouse" | "builtin"
): HTMLElement | null {
  const selectors = [
    "[data-testid*='job-results' i]",
    "[data-testid*='search-results' i]",
    "[data-testid*='results-list' i]",
    "[data-testid*='job-list' i]",
    "[aria-label*='job results' i]",
    "[aria-label*='search results' i]",
    "[class*='job-posts' i]",
    "[class*='search-results' i]",
    "[class*='results-list' i]",
    "[class*='job-list' i]",
    "[class*='openings' i]",
    "[class*='listing' i]",
    "[class*='positions' i]",
    "[class*='roles' i]",
    "main",
    "section",
    "div",
  ];
  const candidates: Array<{ element: HTMLElement; score: number }> = [];
  const seen = new Set<HTMLElement>();

  const pushCandidate = (element: HTMLElement, baseScore = 0) => {
    if (seen.has(element) || !isElementVisible(element) || !isScrollableElement(element)) {
      return;
    }

    seen.add(element);

    const jobLinkCount = countCareerSiteJobLinks(element, site);
    if (jobLinkCount === 0) {
      return;
    }

    const attrs = [
      element.getAttribute("data-testid"),
      element.getAttribute("aria-label"),
      element.className,
      element.id,
    ]
      .join(" ")
      .toLowerCase();

    let score = baseScore + jobLinkCount * 10;
    if (/job-posts|search-results|results-list|job-list/.test(attrs)) score += 40;
    if (/opening|listing|position|role|career|result/.test(attrs)) score += 18;
    if (element.clientWidth > 0 && element.clientWidth < window.innerWidth * 0.95) {
      score += 8;
    }

    candidates.push({ element, score });
  };

  for (const selector of selectors) {
    for (const element of collectDeepMatches<HTMLElement>(selector)) {
      pushCandidate(element);
    }
  }

  for (const selector of getCareerSiteJobLinkSelectors(site)) {
    for (const link of collectDeepMatches<HTMLAnchorElement>(selector)) {
      let depth = 0;
      let ancestor = link.parentElement;
      while (ancestor && depth < 6) {
        pushCandidate(ancestor, Math.max(24 - depth * 4, 0));
        ancestor = ancestor.parentElement;
        depth += 1;
      }
    }
  }

  return candidates.sort((left, right) => right.score - left.score)[0]?.element ?? null;
}

function countCareerSiteJobLinks(
  container: HTMLElement,
  site: "startup" | "other_sites" | "greenhouse" | "builtin"
): number {
  const matches = new Set<HTMLAnchorElement>();

  for (const selector of getCareerSiteJobLinkSelectors(site)) {
    let anchors: HTMLAnchorElement[] = [];
    try {
      anchors = Array.from(container.querySelectorAll<HTMLAnchorElement>(selector));
    } catch {
      continue;
    }

    for (const anchor of anchors) {
      matches.add(anchor);
    }
  }

  return matches.size;
}

function findMonsterScrollableResultsRail(): HTMLElement | null {
  const selectors = [
    "[data-testid*='search-results' i]",
    "[data-testid*='job-results' i]",
    "[data-testid*='results-list' i]",
    "[data-testid*='job-list' i]",
    "[aria-label*='job results' i]",
    "[aria-label*='search results' i]",
    "[class*='search-results' i]",
    "[class*='SearchResults' i]",
    "[class*='results-list' i]",
    "[class*='ResultsList' i]",
    "[class*='jobs-list' i]",
    "[class*='JobsList' i]",
    "[class*='left-column' i]",
    "[class*='LeftColumn' i]",
    "[class*='sidebar' i]",
    "[class*='Sidebar' i]",
    "aside",
    "section",
    "div",
  ];
  const candidates: Array<{ element: HTMLElement; score: number }> = [];
  const seen = new Set<HTMLElement>();
  const pushCandidate = (element: HTMLElement, baseScore = 0) => {
    if (seen.has(element) || !isElementVisible(element) || !isScrollableElement(element)) {
      return;
    }

    seen.add(element);

    const monsterLinks = element.querySelectorAll(
      "a[href*='/job-openings/'], a[href*='/job-opening/'], a[href*='monster.com/job/'], a[href*='job-openings.monster.com'], a[href*='jobview.monster.com']"
    ).length;
    if (monsterLinks === 0) {
      return;
    }

    let score = baseScore + monsterLinks * 10;
    const attrs = [
      element.getAttribute("data-testid"),
      element.getAttribute("aria-label"),
      element.className,
      element.id,
    ]
      .join(" ")
      .toLowerCase();

    if (/search-results|job-results|results-list|job-list/.test(attrs)) score += 40;
    if (/left|sidebar|rail|dashboard|pane|panel/.test(attrs)) score += 16;
    if (element.tagName === "ASIDE") score += 8;
    if (element.clientWidth > 0 && element.clientWidth < window.innerWidth * 0.7) {
      score += 10;
    }

    candidates.push({ element, score });
  };

  for (const selector of selectors) {
    let elements: HTMLElement[];
    try {
      elements = Array.from(document.querySelectorAll<HTMLElement>(selector));
    } catch {
      continue;
    }

    for (const element of elements) {
      pushCandidate(element);
    }
  }

  for (const link of Array.from(
    document.querySelectorAll<HTMLAnchorElement>(
      "a[href*='/job-openings/'], a[href*='/job-opening/'], a[href*='monster.com/job/'], a[href*='job-openings.monster.com'], a[href*='jobview.monster.com']"
    )
  )) {
    let depth = 0;
    let ancestor = link.parentElement;
    while (ancestor && depth < 6) {
      pushCandidate(ancestor, Math.max(24 - depth * 4, 0));
      ancestor = ancestor.parentElement;
      depth += 1;
    }
  }

  return candidates.sort((left, right) => right.score - left.score)[0]?.element ?? null;
}

function isScrollableElement(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  const overflowY = style.overflowY.toLowerCase();
  const allowsScroll =
    overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay";
  const attrs = [
    element.getAttribute("data-testid"),
    element.getAttribute("aria-label"),
    element.className,
    element.id,
  ]
    .join(" ")
    .toLowerCase();
  const likelyResultsContainer = /search-results|job-results|results-list|job-list|job-posts|opening|listing|position|role|dashboard|pane|panel|rail|left/.test(
    attrs
  );

  return (
    element.scrollHeight > element.clientHeight + 80 &&
    (allowsScroll || likelyResultsContainer)
  );
}

function setElementScrollTop(element: HTMLElement, top: number): void {
  element.scrollTop = top;
  try {
    element.scrollTo({ top, behavior: "auto" });
  } catch {
    try {
      element.scrollTo(0, top);
    } catch {
      // Ignore non-scrollable polyfill gaps.
    }
  }
}

function setWindowScrollTop(top: number): void {
  const normalizedTop = Math.max(0, Math.floor(top));
  try {
    window.scrollTo({ top: normalizedTop, behavior: "auto" });
  } catch {
    window.scrollTo(0, normalizedTop);
  }
}

async function waitForDomSettle(
  maxWaitMs: number,
  quietWindowMs: number
): Promise<void> {
  const observer = new MutationObserver(() => {
    lastMutationAt = Date.now();
  });
  let lastMutationAt = Date.now();
  const startedAt = lastMutationAt;

  try {
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
  } catch {
    await sleep(Math.min(maxWaitMs, quietWindowMs));
    return;
  }

  try {
    while (Date.now() - startedAt < maxWaitMs) {
      const quietFor = Date.now() - lastMutationAt;
      if (quietFor >= quietWindowMs) {
        return;
      }

      await sleep(Math.min(quietWindowMs, 150));
    }
  } finally {
    observer.disconnect();
  }
}

async function collectMonsterEmbeddedUrls({
  detectedSite,
  resumeKind,
  datePostedWindow,
  searchKeywords = [],
  candidateCountry,
}: Pick<
  WaitForJobDetailUrlsOptions,
  | "detectedSite"
  | "resumeKind"
  | "datePostedWindow"
  | "searchKeywords"
  | "candidateCountry"
>): Promise<string[]> {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "extract-monster-search-results",
    });
    const embeddedCandidates = collectMonsterEmbeddedCandidates(
      response?.jobResults
    );

    return Array.from(
      new Set(
        pickRelevantJobUrls(
          embeddedCandidates,
          detectedSite,
          resumeKind,
          datePostedWindow,
          searchKeywords,
          window.location.href,
          candidateCountry
        )
      )
    );
  } catch {
    return [];
  }
}

export function getPostedWindowDescription(
  datePostedWindow: DatePostedWindow
): string {
  if (datePostedWindow === "any") {
    return "";
  }

  const label = DATE_POSTED_WINDOW_LABELS[datePostedWindow].toLowerCase();
  return ` posted within ${label.replace(/^past /, "the last ")}`;
}

async function tryRestoreBuiltInKeywordSearch({
  datePostedWindow,
  searchKeywords = [],
  label,
  onOpenListingsSurface,
}: Pick<
  WaitForJobDetailUrlsOptions,
  "datePostedWindow" | "searchKeywords" | "label" | "onOpenListingsSurface"
>): Promise<boolean> {
  const desiredKeyword = getPrimaryBuiltInSearchKeyword(searchKeywords);
  if (!desiredKeyword || !shouldRestoreBuiltInKeywordSearch(desiredKeyword)) {
    return false;
  }

  const labelPrefix = label ? `${label} ` : "";
  onOpenListingsSurface?.(
    `Restoring ${labelPrefix}Built In search for ${desiredKeyword}...`
  );

  const input = findBuiltInKeywordInput();
  if (input && applyTextInputValue(input, desiredKeyword)) {
    const searchAction = findBuiltInSearchAction(input);
    if (searchAction && isElementInteractive(searchAction)) {
      performClickAction(searchAction);
      await sleep(1_800);
      return true;
    }

    const form = input.form;
    if (form) {
      try {
        form.requestSubmit();
      } catch {
        try {
          form.submit();
        } catch {
          // Fall back to navigation below if the surface blocks submission.
        }
      }
      await sleep(1_800);
      return true;
    }
  }

  const targetUrl = buildBuiltInSearchRecoveryUrl(
    desiredKeyword,
    datePostedWindow
  );
  const currentUrl = normalizeUrl(window.location.href);
  if (targetUrl && normalizeUrl(targetUrl) !== currentUrl) {
    window.location.assign(targetUrl);
    return true;
  }

  return false;
}

async function tryOpenCareerListingsSurface({
  site,
  datePostedWindow,
  detectedSite,
  resumeKind,
  searchKeywords = [],
  candidateCountry,
  label,
  onOpenListingsSurface,
}: Omit<WaitForJobDetailUrlsOptions, "targetCount">): Promise<boolean> {
  const iframeUrl = findCareerListingsIframeUrl();
  const currentUrl = normalizeUrl(window.location.href);
  const labelPrefix = label ? `${label} ` : "";

  if (iframeUrl && iframeUrl !== currentUrl) {
    onOpenListingsSurface?.(
      `Opening ${labelPrefix}${getSiteLabel(site)} jobs list...`
    );
    window.location.assign(iframeUrl);
    return true;
  }

  const actions = collectCareerListingActions();
  for (const action of actions) {
    const beforeUrl = normalizeUrl(window.location.href);

    onOpenListingsSurface?.(
      `Opening ${labelPrefix}${getSiteLabel(site)} jobs list...`
    );

    if (action.navUrl && action.navUrl !== beforeUrl) {
      window.location.assign(action.navUrl);
      return true;
    }

    if (!isElementInteractive(action.element)) {
      continue;
    }

    performClickAction(action.element);
    await sleep(1500);

    if (normalizeUrl(window.location.href) !== beforeUrl) {
      return true;
    }

    const updatedCandidates = collectJobDetailCandidates(site);
    const updatedUrls = pickRelevantJobUrls(
      updatedCandidates,
      detectedSite,
      resumeKind,
      datePostedWindow,
      searchKeywords,
      window.location.href,
      candidateCountry
    );
    if (updatedUrls.length > 0) {
      return true;
    }
  }

  return false;
}

function findCareerListingsIframeUrl(): string | null {
  for (const frame of Array.from(
    document.querySelectorAll<HTMLIFrameElement>("iframe[src]")
  )) {
    if (!isElementVisible(frame)) {
      continue;
    }

    const src = normalizeUrl(frame.src || frame.getAttribute("src") || "");
    if (!src) {
      continue;
    }

    const lowerSrc = src.toLowerCase();
    const title = cleanText(
      frame.getAttribute("title") || frame.getAttribute("aria-label") || ""
    ).toLowerCase();

    if (includesAnyToken(lowerSrc, CAREER_LISTING_URL_PATTERNS) || title.includes("job") || title.includes("career")) {
      return src;
    }
  }

  return null;
}

function collectCareerListingActions(): Array<{
  element: HTMLElement;
  navUrl: string | null;
  score: number;
}> {
  const actions: Array<{
    element: HTMLElement;
    navUrl: string | null;
    score: number;
  }> = [];
  const seen = new Set<string>();

  for (const element of Array.from(
    document.querySelectorAll<HTMLElement>(
      "a[href], button, [role='button'], [data-href], [data-url], [data-link]"
    )
  )) {
    if (!isElementVisible(element)) {
      continue;
    }

    const text = cleanText(getActionText(element)).toLowerCase();
    const navUrl = getNavigationUrl(element);
    const lowerNavUrl = navUrl?.toLowerCase() ?? "";
    const hasTextSignal = includesAnyToken(text, CAREER_LISTING_TEXT_PATTERNS);
    const hasUrlSignal = includesAnyToken(lowerNavUrl, CAREER_LISTING_URL_PATTERNS);

    if (!hasTextSignal && !hasUrlSignal) {
      continue;
    }

    if (
      ["sign in", "create alert", "job alert", "talent network", "saved jobs"].some(
        (token) => text.includes(token)
      ) ||
      lowerNavUrl.includes("/users/sign_in") ||
      lowerNavUrl.includes("job_alert")
    ) {
      continue;
    }

    const dedupKey = `${navUrl ?? ""}::${text}`;
    if (seen.has(dedupKey)) {
      continue;
    }
    seen.add(dedupKey);

    let score = 0;
    if (hasTextSignal) score += 4;
    if (hasUrlSignal) score += 3;
    if (includesAnyToken(text, PRIORITY_CAREER_LISTING_TEXT_PATTERNS)) {
      score += 3;
    }
    if (includesAnyToken(lowerNavUrl, PRIORITY_CAREER_LISTING_URL_PATTERNS)) {
      score += 5;
    }

    actions.push({
      element,
      navUrl,
      score,
    });
  }

  return actions.sort((a, b) => b.score - a.score);
}

function getPrimaryBuiltInSearchKeyword(searchKeywords: string[]): string {
  for (const keyword of searchKeywords) {
    const trimmed = cleanText(keyword);
    if (trimmed) {
      return trimmed;
    }
  }

  return "";
}

function shouldRestoreBuiltInKeywordSearch(desiredKeyword: string): boolean {
  const normalizedDesiredKeyword = normalizeBuiltInKeyword(desiredKeyword);
  if (!normalizedDesiredKeyword) {
    return false;
  }

  try {
    const currentUrl = new URL(window.location.href);
    const currentPath = currentUrl.pathname.toLowerCase().replace(/\/+$/, "");
    const currentSearchKeyword = normalizeBuiltInKeyword(
      currentUrl.searchParams.get("search") || ""
    );

    if (
      currentSearchKeyword === normalizedDesiredKeyword &&
      currentPath.startsWith("/jobs/remote")
    ) {
      return false;
    }
  } catch {
    // Fall through to DOM-based recovery when the current URL is malformed.
  }

  const input = findBuiltInKeywordInput();
  if (!input) {
    return true;
  }

  return normalizeBuiltInKeyword(input.value || "") !== normalizedDesiredKeyword;
}

function buildBuiltInSearchRecoveryUrl(
  keyword: string,
  datePostedWindow: DatePostedWindow
): string {
  const url = new URL("/jobs/remote", window.location.origin || "https://builtin.com");
  url.searchParams.set("search", keyword);
  const daysSinceUpdated = getBuiltInDaysSinceUpdatedValue(datePostedWindow);
  if (daysSinceUpdated) {
    url.searchParams.set("daysSinceUpdated", daysSinceUpdated);
  }
  return url.toString();
}

function findBuiltInKeywordInput():
  | HTMLInputElement
  | HTMLTextAreaElement
  | null {
  const candidates: Array<{
    element: HTMLInputElement | HTMLTextAreaElement;
    score: number;
  }> = [];

  for (const element of collectDeepMatches<
    HTMLInputElement | HTMLTextAreaElement
  >("input, textarea")) {
    if (
      !(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) ||
      !element.isConnected ||
      element.disabled
    ) {
      continue;
    }

    const type =
      element instanceof HTMLInputElement ? element.type.toLowerCase() : "textarea";
    if (
      element instanceof HTMLInputElement &&
      type &&
      !["", "search", "text"].includes(type)
    ) {
      continue;
    }

    const attrs = cleanText(
      [
        element.id,
        element.name,
        element.placeholder,
        element.getAttribute("aria-label"),
      ]
        .filter(Boolean)
        .join(" ")
    ).toLowerCase();

    if (
      !(
        attrs.includes("keyword") ||
        attrs.includes("job title") ||
        attrs.includes("company")
      ) ||
      attrs.includes("location")
    ) {
      continue;
    }

    let score = 0;
    if (element.id === "searchJobsInput") score += 120;
    if (attrs.includes("keyword")) score += 40;
    if (attrs.includes("job title")) score += 35;
    if (attrs.includes("company")) score += 10;
    if (element.form) score += 8;

    candidates.push({ element, score });
  }

  return candidates.sort((left, right) => right.score - left.score)[0]?.element ?? null;
}

function findBuiltInSearchAction(
  input: HTMLInputElement | HTMLTextAreaElement
): HTMLElement | null {
  const candidates: Array<{ element: HTMLElement; score: number }> = [];
  const scopes = new Set<ParentNode>([
    document,
    input.form ?? document,
    input.parentElement ?? document,
    input.closest("form, section, article, main, div") ?? document,
  ]);

  for (const scope of scopes) {
    const elements =
      scope instanceof Document
        ? collectDeepMatches<HTMLElement>(
            "button, [role='button'], input[type='submit'], input[type='button']"
          )
        : Array.from(
            scope.querySelectorAll<HTMLElement>(
              "button, [role='button'], input[type='submit'], input[type='button']"
            )
          );

    for (const element of elements) {
      if (!isElementVisible(element)) {
        continue;
      }

      const text = cleanText(
        [
          getActionText(element),
          element.getAttribute("aria-label"),
          element.getAttribute("title"),
          element.getAttribute("data-testid"),
        ]
          .filter(Boolean)
          .join(" ")
      ).toLowerCase();

      const isSearchAction =
        text.includes("search jobs") ||
        text === "search" ||
        text.startsWith("search ");
      if (!isSearchAction) {
        continue;
      }

      let score = 0;
      if (text.includes("search jobs")) score += 100;
      if (element.getAttribute("aria-label")?.toLowerCase().includes("search")) {
        score += 35;
      }
      if (input.form && element.closest("form") === input.form) score += 25;
      if (input.parentElement && input.parentElement.contains(element)) score += 12;
      if (scope !== document) score += 8;

      candidates.push({ element, score });
    }
  }

  return candidates.sort((left, right) => right.score - left.score)[0]?.element ?? null;
}

function applyTextInputValue(
  input: HTMLInputElement | HTMLTextAreaElement,
  value: string
): boolean {
  const nextValue = value.trim();
  if (!nextValue) {
    return false;
  }

  if (input.value !== nextValue) {
    const prototype =
      input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");

    try {
      descriptor?.set?.call(input, nextValue);
    } catch {
      input.value = nextValue;
    }
  }

  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

function normalizeBuiltInKeyword(value: string): string {
  return cleanText(value).toLowerCase();
}

function tryClickLoadMoreButton(): void {
  for (const el of collectDeepMatches<HTMLElement>(
    "button, a[role='button'], [role='button']"
  )) {
    if (!isElementVisible(el) || !isElementInteractive(el)) {
      continue;
    }

    const text = cleanText(getActionText(el)).toLowerCase();
    const attrs = cleanText(
      [
        el.getAttribute("aria-label"),
        el.getAttribute("title"),
        el.getAttribute("data-testid"),
        el.getAttribute("data-test"),
        el.id,
        el.className,
      ]
        .filter(Boolean)
        .join(" ")
    ).toLowerCase();

    if (
      text.includes("load more") ||
      text.includes("show more") ||
      text.includes("view more") ||
      text.includes("see more") ||
      text.includes("more jobs") ||
      text.includes("more positions") ||
      text.includes("more openings") ||
      text.includes("view all") ||
      text.includes("see all") ||
      text.includes("show all") ||
      text.includes("load next") ||
      text.includes("show more jobs") ||
      text.includes("more results") ||
      attrs.includes("show more jobs") ||
      attrs.includes("load more jobs")
    ) {
      performClickAction(el);
      return;
    }
  }
}

export function findNextResultsPageAction(
  site: SiteKey
): Pick<SearchResultsPageAction, "element" | "navUrl" | "text"> | null {
  let bestAction: SearchResultsPageAction | null = null;

  for (const element of collectDeepMatches<HTMLElement>(
    "a[href], button, input[type='button'], input[type='submit'], [role='button'], [role='link']"
  )) {
    const candidate = scoreNextResultsPageAction(element, site);
    if (!candidate) {
      continue;
    }

    if (!bestAction || candidate.score > bestAction.score) {
      bestAction = candidate;
    }
  }

  if (!bestAction) {
    return null;
  }

  return {
    element: bestAction.element,
    navUrl: bestAction.navUrl,
    text: bestAction.text,
  };
}

export async function advanceToNextResultsPage(
  site: SiteKey
): Promise<SearchResultsAdvanceResult> {
  let action = findNextResultsPageAction(site);
  if (!action) {
    window.scrollTo({
      top: document.body.scrollHeight,
      behavior: "smooth",
    });
    await waitForResultSurfaceSettle(site);
    action = findNextResultsPageAction(site);
  }

  if (!action) {
    return "none";
  }

  const beforeUrl = normalizeUrl(window.location.href);
  const beforeSignature = getResultPageSignature(site);

  if (action.navUrl && action.navUrl !== beforeUrl) {
    window.location.assign(action.navUrl);
    return "navigating";
  }

  try {
    action.element.scrollIntoView({ behavior: "smooth", block: "center" });
  } catch {
    // Some controls cannot be scrolled into view programmatically.
  }

  await sleep(200);
  performClickAction(action.element);
  return waitForResultsPageAdvance(site, beforeUrl, beforeSignature);
}

function scoreNextResultsPageAction(
  element: HTMLElement,
  site: SiteKey
): SearchResultsPageAction | null {
  if (!isPaginationControlVisible(element) || !isPaginationControlInteractive(element)) {
    return null;
  }

  if (isDisabledPaginationElement(element)) {
    return null;
  }

  const text = cleanText(getActionText(element)).toLowerCase();
  const navUrl = getNavigationUrl(element);
  const lowerNavUrl = navUrl?.toLowerCase() ?? "";
  const attrs = cleanText(
    [
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.getAttribute("data-testid"),
      element.getAttribute("data-test"),
      element.getAttribute("rel"),
      element.id,
      element.className,
    ]
      .filter(Boolean)
      .join(" ")
  ).toLowerCase();
  const insidePagination = isInsidePaginationContainer(element);
  const hasSiblingPaginationContext = hasSiblingPageIndicators(element);
  const hasPaginationContext =
    insidePagination ||
    hasSiblingPaginationContext ||
    attrs.includes("pagination") ||
    attrs.includes("paginator") ||
    attrs.includes("pager") ||
    lowerNavUrl.includes("page=") ||
    lowerNavUrl.includes("offset=") ||
    lowerNavUrl.includes("start=") ||
    hasPaginationUrlSignal(navUrl);

  if (
    /(?:^|\b)(previous|prev|back)(?:\b|$)/.test(text) ||
    /(?:^|\b)(previous|prev|back)(?:\b|$)/.test(attrs)
  ) {
    return null;
  }

  if (
    isCurrentPageIndicator(element)
  ) {
    return null;
  }

  const isExplicitNext =
    text.includes("next page") ||
    text.includes("next results") ||
    text.includes("next jobs") ||
    /(?:^|\b)next(?:\b|$)/.test(text) ||
    text === "next" ||
    attrs.includes("next page") ||
    attrs.includes("next results") ||
    attrs.includes("next jobs") ||
    /(?:^|\b)next(?:\b|$)/.test(attrs) ||
    attrs.includes("pagination-next") ||
    attrs.includes("pager-next") ||
    attrs.includes("rel next");
  const isTrailingAdvanceControl = isTrailingPaginationAdvanceControl(
    element,
    text,
    attrs,
    navUrl
  );
  const isNextNumberedPage = isNextNumberedPaginationControl(element);
  const isArrowNext =
    (insidePagination || hasSiblingPaginationContext) &&
    (text === "next" || NEXT_PAGE_ARROW_LABELS.has(text));

  if (!isExplicitNext && !isArrowNext && !isTrailingAdvanceControl && !isNextNumberedPage) {
    return null;
  }

  if (
    !hasPaginationContext &&
    !text.includes("next page") &&
    !attrs.includes("next page") &&
    !isNextNumberedPage
  ) {
    return null;
  }

  let score = 0;

  if (isExplicitNext) {
    score += 60;
  }
  if (isArrowNext) {
    score += 24;
  }
  if (isTrailingAdvanceControl) {
    score += 22;
  }
  if (isNextNumberedPage) {
    score += 26;
  }
  if (insidePagination) {
    score += 18;
  }
  if (hasSiblingPaginationContext) {
    score += 12;
  }
  if (hasPaginationUrlSignal(navUrl)) {
    score += 16;
  }
  if (navUrl && navUrl !== normalizeUrl(window.location.href)) {
    score += 12;
  }
  if (attrs.includes("pagination-next") || attrs.includes("pager-next")) {
    score += 12;
  }
  if (site === "indeed" && (attrs.includes("pagination-page-next") || attrs.includes("next page"))) {
    score += 16;
  }
  if (site === "dice" && (attrs.includes("pagination") || attrs.includes("pager"))) {
    score += 10;
  }
  if (site === "greenhouse" && hasSiblingPaginationContext) {
    score += 12;
  }

  return {
    element,
    navUrl,
    score,
    text,
  };
}

function hasSiblingPageIndicators(element: HTMLElement): boolean {
  const controls = findSiblingPaginationControls(element);
  if (controls.length < 2) {
    return false;
  }

  const hasCurrentPageIndicator = controls.some(
    (candidate) => isCurrentPageIndicator(candidate)
  );
  const hasAnotherPaginationControl = controls.some((candidate) => {
    if (candidate === element) {
      return false;
    }

    const text = getPaginationControlText(candidate);
    return (
      /^\d+$/.test(text) ||
      text === "previous" ||
      text === "prev" ||
      text === "next" ||
      NEXT_PAGE_ARROW_LABELS.has(text)
    );
  });

  return hasCurrentPageIndicator && hasAnotherPaginationControl;
}

function findSiblingPaginationControls(element: HTMLElement): HTMLElement[] {
  let container = element.parentElement;

  for (let depth = 0; container && depth < 4; depth += 1) {
    const controls = Array.from(
      container.querySelectorAll<HTMLElement>(
        "a[href], button, input[type='button'], input[type='submit'], [role='button'], [role='link'], [aria-current='page'], [aria-selected='true']"
      )
    ).filter((candidate) => isPaginationControlVisible(candidate));

    if (controls.length >= 2 && controls.includes(element)) {
      const hasCurrent = controls.some((candidate) =>
        isCurrentPageIndicator(candidate)
      );
      const hasRecognizablePaginationControl = controls.some((candidate) => {
        const text = getPaginationControlText(candidate);
        return (
          /^\d+$/.test(text) ||
          text === "previous" ||
          text === "prev" ||
          text === "next" ||
          NEXT_PAGE_ARROW_LABELS.has(text)
        );
      });

      if (hasCurrent || hasRecognizablePaginationControl) {
        return controls;
      }
    }

    container = container.parentElement;
  }

  return [];
}

function getPaginationControlText(element: HTMLElement): string {
  return cleanText(getActionText(element)).toLowerCase();
}

function getPaginationControlAttrs(element: HTMLElement): string {
  return cleanText(
    [
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.getAttribute("data-testid"),
      element.getAttribute("data-test"),
      element.getAttribute("data-current"),
      element.getAttribute("data-selected"),
      element.className,
    ]
      .filter(Boolean)
      .join(" ")
  ).toLowerCase();
}

function isCurrentPageIndicator(element: HTMLElement): boolean {
  const attrs = getPaginationControlAttrs(element);

  return (
    element.getAttribute("aria-current") === "page" ||
    element.getAttribute("aria-current") === "true" ||
    element.getAttribute("aria-selected") === "true" ||
    element.getAttribute("data-current") === "true" ||
    element.getAttribute("data-selected") === "true" ||
    /(?:^|\b)(active|selected|current|page-active|page-current)(?:\b|$)/.test(
      attrs
    )
  );
}

function extractPaginationPageNumber(element: HTMLElement): number | null {
  const text = getPaginationControlText(element);
  if (/^\d+$/.test(text)) {
    return Number.parseInt(text, 10);
  }

  const attrs = getPaginationControlAttrs(element);
  const match = attrs.match(/(?:go to\s+)?page\s+(\d+)/i);
  if (!match?.[1]) {
    return null;
  }

  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function getCurrentPaginationPageNumber(controls: HTMLElement[]): number | null {
  for (const control of controls) {
    if (!isCurrentPageIndicator(control)) {
      continue;
    }

    const pageNumber = extractPaginationPageNumber(control);
    if (pageNumber !== null) {
      return pageNumber;
    }
  }

  return null;
}

function isNextNumberedPaginationControl(element: HTMLElement): boolean {
  const controls = findSiblingPaginationControls(element);
  if (controls.length < 2 || isCurrentPageIndicator(element)) {
    return false;
  }

  const text = getPaginationControlText(element);
  const attrs = getPaginationControlAttrs(element);
  if (
    /(?:^|\b)(previous|prev|back)(?:\b|$)/.test(text) ||
    /(?:^|\b)(previous|prev|back)(?:\b|$)/.test(attrs)
  ) {
    return false;
  }

  const pageNumber = extractPaginationPageNumber(element);
  const currentPage = getCurrentPaginationPageNumber(controls);
  if (pageNumber === null || currentPage === null || pageNumber <= currentPage) {
    return false;
  }

  const nextAvailablePage = controls
    .map((control) => extractPaginationPageNumber(control))
    .filter((value): value is number => value !== null && value > currentPage)
    .sort((left, right) => left - right)[0];

  return nextAvailablePage === pageNumber;
}

function isTrailingPaginationAdvanceControl(
  element: HTMLElement,
  text: string,
  attrs: string,
  navUrl: string | null
): boolean {
  const controls = findSiblingPaginationControls(element);
  if (controls.length < 2) {
    return false;
  }

  const elementIndex = controls.indexOf(element);
  if (elementIndex < 0 || elementIndex !== controls.length - 1) {
    return false;
  }

  if (
    isCurrentPageIndicator(element) ||
    /(?:^|\b)(previous|prev|back)(?:\b|$)/.test(text) ||
    /(?:^|\b)(previous|prev|back)(?:\b|$)/.test(attrs)
  ) {
    return false;
  }

  if (extractPaginationPageNumber(element) !== null) {
    return false;
  }

  const previousControls = controls.slice(0, elementIndex);
  const hasCurrentBefore = previousControls.some((candidate) =>
    isCurrentPageIndicator(candidate)
  );
  const hasNumberedPagesBefore = previousControls.some((candidate) =>
    /^\d+$/.test(getPaginationControlText(candidate))
  );

  if (!hasCurrentBefore || !hasNumberedPagesBefore) {
    return false;
  }

  return (
    !text ||
    NEXT_PAGE_ARROW_LABELS.has(text) ||
    hasPaginationUrlSignal(navUrl) ||
    /(?:^|\b)(next|forward|right|chevron|arrow|page-next)(?:\b|$)/.test(attrs)
  );
}

function isInsidePaginationContainer(element: HTMLElement): boolean {
  return Boolean(
    element.closest(
      "nav, [role='navigation'], [aria-label*='pagination' i], [class*='pagination'], [data-testid*='pagination' i], [data-test*='pagination' i], [class*='pager']"
    )
  );
}

function isDisabledPaginationElement(element: HTMLElement): boolean {
  const attrs = cleanText(
    [
      element.getAttribute("aria-disabled"),
      element.getAttribute("data-disabled"),
      element.className,
    ]
      .filter(Boolean)
      .join(" ")
  ).toLowerCase();

  return Boolean(
    element.matches("[disabled], [aria-disabled='true'], [data-disabled='true']") ||
      /(?:^|\b)(disabled|is-disabled|inactive|is-inactive|pagination-disabled|pager-disabled)(?:\b|$)/.test(
        attrs
      )
  );
}

function isPaginationControlVisible(element: HTMLElement): boolean {
  if (isElementVisible(element)) {
    return true;
  }

  if (!element?.isConnected) {
    return false;
  }

  const styles = window.getComputedStyle(element);
  const opacity = Number.parseFloat(styles.opacity);
  if (
    styles.visibility === "hidden" ||
    styles.visibility === "collapse" ||
    styles.display === "none" ||
    (Number.isFinite(opacity) && opacity <= 0.01)
  ) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return false;
  }

  return isInsidePaginationContainer(element);
}

function isPaginationControlInteractive(element: HTMLElement): boolean {
  if (!isPaginationControlVisible(element)) {
    return false;
  }

  if (
    element.hasAttribute("disabled") ||
    (element as HTMLButtonElement | HTMLInputElement).disabled
  ) {
    return false;
  }

  if (element.getAttribute("aria-disabled") === "true") {
    return false;
  }

  return window.getComputedStyle(element).pointerEvents !== "none";
}

function hasPaginationUrlSignal(url: string | null): boolean {
  if (!url) {
    return false;
  }

  try {
    const parsed = new URL(url, window.location.href);
    const queryKeys = [
      "page",
      "p",
      "pg",
      "offset",
      "start",
      "fromage",
      "pn",
      "pageNum",
    ];

    if (
      queryKeys.some((key) => {
        const value = parsed.searchParams.get(key);
        return Boolean(value && value.trim().length > 0);
      })
    ) {
      return true;
    }

    return /\/page\/\d+\b|\/p\/\d+\b|\/jobs\/page\/\d+\b/i.test(
      parsed.pathname
    );
  } catch {
    return false;
  }
}

function getResultPageSignature(site: SiteKey): string {
  const currentUrl = normalizeUrl(window.location.href) ?? "";
  const pageMarkers = collectDeepMatches<HTMLElement>(
    "[aria-current='page'], [aria-selected='true'], [data-current='true'], .selected, .active"
  )
    .filter((element) => isElementVisible(element))
    .map((element) => cleanText(getActionText(element)).toLowerCase())
    .filter(Boolean)
    .slice(0, 6)
    .join("|");
  const candidateMarkers = collectJobDetailCandidates(site)
    .slice(0, 12)
    .map((candidate) => normalizeUrl(candidate.url) ?? candidate.url)
    .join("|");

  return [currentUrl, pageMarkers, candidateMarkers].join("::");
}

async function waitForResultsPageAdvance(
  site: SiteKey,
  beforeUrl: string | null,
  beforeSignature: string
): Promise<SearchResultsAdvanceResult> {
  const startedAt = Date.now();
  let urlChangedAt: number | null = null;

  while (Date.now() - startedAt < NEXT_PAGE_ADVANCE_TIMEOUT_MS) {
    await waitForResultSurfaceSettle(site);

    const afterUrl = normalizeUrl(window.location.href);
    const afterSignature = getResultPageSignature(site);

    if (afterSignature !== beforeSignature) {
      return "advanced";
    }

    if (afterUrl && afterUrl !== beforeUrl) {
      if (urlChangedAt === null) {
        urlChangedAt = Date.now();
      } else if (Date.now() - urlChangedAt >= NEXT_PAGE_URL_CHANGE_GRACE_MS) {
        return "navigating";
      }
    } else {
      urlChangedAt = null;
    }

    await sleep(NEXT_PAGE_ADVANCE_POLL_MS);
  }

  return urlChangedAt !== null ? "navigating" : "none";
}

function isMyGreenhousePortalHost(): boolean {
  try {
    const parsed = new URL(window.location.href);
    return parsed.hostname.toLowerCase().replace(/^www\./, "") === "my.greenhouse.io";
  } catch {
    return false;
  }
}
