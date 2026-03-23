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
    window.scrollTo({ top: target, behavior: "smooth" });
    await waitForDomSettle(1_000, 350);

    if (totalHeight <= previousHeight && step >= 2) {
      break;
    }
    previousHeight = totalHeight;
  }

  window.scrollTo({ top: 0, behavior: "smooth" });
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
  label,
  onOpenListingsSurface,
}: WaitForJobDetailUrlsOptions): Promise<string[]> {
  const isCareerSite = site === "startup" || site === "other_sites";
  const needsAggressiveScan =
    isCareerSite ||
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
          searchKeywords
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
      if (careerSurfaceAttempts < 2 && (attempt === 8 || attempt === 18)) {
        careerSurfaceAttempts += 1;
        const openedCareerSurface = await tryOpenCareerListingsSurface({
          site,
          datePostedWindow,
          detectedSite,
          resumeKind,
          searchKeywords,
          label,
          onOpenListingsSurface,
        });
        if (openedCareerSurface) {
          await waitForDomSettle(2_400, 500);
        }
      }

      if (attempt % 5 === 0) {
        window.scrollTo({
          top: document.body.scrollHeight,
          behavior: "smooth",
        });
      } else if (attempt % 5 === 1) {
        window.scrollTo({
          top: document.body.scrollHeight / 2,
          behavior: "smooth",
        });
      } else if (attempt % 5 === 2) {
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else if (attempt % 5 === 3) {
        window.scrollTo({
          top: document.body.scrollHeight / 3,
          behavior: "smooth",
        });
      } else {
        window.scrollTo({
          top: (document.body.scrollHeight * 2) / 3,
          behavior: "smooth",
        });
      }

      if (attempt === 10 || attempt === 20 || attempt === 30) {
        tryClickLoadMoreButton();
      }
    } else if (
      site === "indeed" ||
      site === "dice" ||
      site === "ziprecruiter" ||
      site === "glassdoor"
    ) {
      if (attempt % 4 === 0) {
        window.scrollTo({
          top: document.body.scrollHeight,
          behavior: "smooth",
        });
      } else if (attempt % 4 === 1) {
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else if (attempt % 4 === 2) {
        window.scrollTo({
          top: document.body.scrollHeight / 2,
          behavior: "smooth",
        });
      } else {
        window.scrollTo({
          top: document.body.scrollHeight / 3,
          behavior: "smooth",
        });
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
      window.scrollTo({
        top: document.body.scrollHeight,
        behavior: "smooth",
      });
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
}: Pick<
  WaitForJobDetailUrlsOptions,
  "detectedSite" | "resumeKind" | "datePostedWindow" | "searchKeywords"
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
          searchKeywords
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
      searchKeywords
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
    "a[href], button, input[type='button'], input[type='submit'], [role='button']"
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
  const action = findNextResultsPageAction(site);
  if (!action) {
    return "none";
  }

  const beforeUrl = normalizeUrl(window.location.href);
  const beforeSignature = getResultPageSignature(site);

  if (action.navUrl && action.navUrl !== beforeUrl) {
    window.location.assign(action.navUrl);
    return "navigating";
  }

  performClickAction(action.element);
  await waitForResultSurfaceSettle(site);

  const afterUrl = normalizeUrl(window.location.href);
  const afterSignature = getResultPageSignature(site);

  if ((afterUrl && afterUrl !== beforeUrl) || afterSignature !== beforeSignature) {
    return afterUrl && afterUrl !== beforeUrl ? "navigating" : "advanced";
  }

  return "none";
}

function scoreNextResultsPageAction(
  element: HTMLElement,
  site: SiteKey
): SearchResultsPageAction | null {
  if (!isElementVisible(element) || !isElementInteractive(element)) {
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
  const hasPaginationContext =
    insidePagination ||
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
    element.getAttribute("aria-current") === "page" ||
    element.getAttribute("aria-selected") === "true" ||
    /^\d+$/.test(text)
  ) {
    return null;
  }

  const isExplicitNext =
    text.includes("next page") ||
    text.includes("next results") ||
    text.includes("next jobs") ||
    text === "next" ||
    attrs.includes("next page") ||
    attrs.includes("next results") ||
    attrs.includes("next jobs") ||
    attrs.includes("pagination-next") ||
    attrs.includes("pager-next") ||
    attrs.includes("rel next");
  const isArrowNext =
    insidePagination &&
    ["›", "»", ">", "→", "⟩", "❯", "next"].includes(text);

  if (!isExplicitNext && !isArrowNext) {
    return null;
  }

  if (!hasPaginationContext && !text.includes("next page") && !attrs.includes("next page")) {
    return null;
  }

  let score = 0;

  if (isExplicitNext) {
    score += 60;
  }
  if (isArrowNext) {
    score += 24;
  }
  if (insidePagination) {
    score += 18;
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

  return {
    element,
    navUrl,
    score,
    text,
  };
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
      /(?:^|\b)(disabled|is-disabled|pagination-disabled|pager-disabled)(?:\b|$)/.test(
        attrs
      )
  );
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
  const pageMarkers = Array.from(
    document.querySelectorAll<HTMLElement>(
      "[aria-current='page'], [aria-selected='true'], [data-current='true'], .selected, .active"
    )
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
