import {
  DATE_POSTED_WINDOW_LABELS,
  DatePostedWindow,
  ResumeKind,
  SiteKey,
  getJobDedupKey,
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
  const needsAggressiveScan =
    isCareerSite ||
    site === "monster" ||
    site === "indeed" ||
    site === "dice" ||
    site === "ziprecruiter" ||
    site === "glassdoor";
  let careerSurfaceAttempts = 0;
  const desiredCount = Math.max(1, Math.floor(targetCount));
  let bestUrls: string[] = [];
  let previousSignature = "";
  let stablePasses = 0;
  let monsterEmbeddedAttempts = 0;

  const maxAttempts = needsAggressiveScan ? 50 : 35;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
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
        !isMyGreenhousePortal &&
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
      ["sign in", "job alert", "talent network", "saved jobs"].some(
        (token) => text.includes(token) || lowerNavUrl.includes(token)
      )
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

  while (Date.now() - startedAt < NEXT_PAGE_ADVANCE_TIMEOUT_MS) {
    await waitForResultSurfaceSettle(site);

    const afterUrl = normalizeUrl(window.location.href);
    const afterSignature = getResultPageSignature(site);

    if ((afterUrl && afterUrl !== beforeUrl) || afterSignature !== beforeSignature) {
      return afterUrl && afterUrl !== beforeUrl ? "navigating" : "advanced";
    }

    await sleep(NEXT_PAGE_ADVANCE_POLL_MS);
  }

  return "none";
}

function isMyGreenhousePortalHost(): boolean {
  try {
    const parsed = new URL(window.location.href);
    return parsed.hostname.toLowerCase().replace(/^www\./, "") === "my.greenhouse.io";
  } catch {
    return false;
  }
}
