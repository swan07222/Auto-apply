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
import { cleanText } from "./text";

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
  const maxWaitMs =
    site === "startup" || site === "other_sites" || site === "glassdoor"
      ? 1_600
      : site === "indeed" || site === "dice" || site === "ziprecruiter"
        ? 1_400
        : 1_000;

  await waitForDomSettle(maxWaitMs, 350);
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
  const loadMoreSelectors = ["button", "a[role='button']", "[role='button']"];

  for (const selector of loadMoreSelectors) {
    try {
      const elements = Array.from(
        document.querySelectorAll<HTMLElement>(selector)
      );
      for (const el of elements) {
        if (!isElementVisible(el)) continue;
        const text = cleanText(el.textContent || "").toLowerCase();
        const attrs = [
          el.getAttribute("aria-label"),
          el.getAttribute("title"),
          el.getAttribute("data-testid"),
          el.id,
          el.className,
        ]
          .join(" ")
          .toLowerCase();
        const insidePagination = Boolean(
          el.closest("nav, [aria-label*='pagination' i], [class*='pagination']")
        );

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
          text.includes("next page") ||
          text.includes("load next") ||
          text.includes("show more jobs") ||
          text.includes("more results") ||
          attrs.includes("next page") ||
          attrs.includes("next results") ||
          attrs.includes("show more jobs") ||
          attrs.includes("load more jobs") ||
          attrs.includes("pagination-next") ||
          (text === "next" && insidePagination)
        ) {
          performClickAction(el);
          return;
        }
      }
    } catch {
      // Skip
    }
  }
}
