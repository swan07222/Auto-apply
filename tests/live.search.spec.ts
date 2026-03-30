import { JSDOM } from "jsdom";
import { expect, test, type Page } from "@playwright/test";

import {
  DEFAULT_SETTINGS,
  type SearchTarget,
  type SiteKey,
  buildOtherJobSiteTargets,
  buildSearchTargets,
  buildStartupSearchTargets,
  isProbablyHumanVerificationPage,
} from "../src/shared";
import {
  collectJobDetailCandidates,
  collectMonsterEmbeddedCandidates,
  isLikelyJobDetailUrl,
  pickRelevantJobUrls,
} from "../src/content/jobSearch";
import {
  CAREER_LISTING_TEXT_PATTERNS,
  CAREER_LISTING_URL_PATTERNS,
} from "../src/content/sitePatterns";

const LIVE_TESTS_ENABLED = process.env.ENABLE_LIVE_TESTS === "1";
const SETTLE_DELAY_MS = 3_500;

const US_SETTINGS = {
  ...DEFAULT_SETTINGS,
  startupRegion: "us" as const,
  searchKeywords: "software engineer",
  candidate: {
    ...DEFAULT_SETTINGS.candidate,
    country: "United States",
  },
};

const UK_SETTINGS = {
  ...DEFAULT_SETTINGS,
  startupRegion: "uk" as const,
  searchKeywords: "software engineer",
  candidate: {
    ...DEFAULT_SETTINGS.candidate,
    country: "United Kingdom",
  },
};

const EU_SETTINGS = {
  ...DEFAULT_SETTINGS,
  startupRegion: "eu" as const,
  searchKeywords: "software engineer",
  candidate: {
    ...DEFAULT_SETTINGS.candidate,
    country: "Germany",
  },
};

function dedupeTargets(targets: SearchTarget[]): SearchTarget[] {
  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = `${target.label}::${target.url}::${target.resumeKind}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

const STARTUP_TARGETS = dedupeTargets([
  ...buildStartupSearchTargets(US_SETTINGS),
  ...buildStartupSearchTargets(UK_SETTINGS),
  ...buildStartupSearchTargets(EU_SETTINGS),
]);

const OTHER_SITE_TARGETS = dedupeTargets([
  ...buildOtherJobSiteTargets(US_SETTINGS),
  ...buildOtherJobSiteTargets(UK_SETTINGS),
  ...buildOtherJobSiteTargets(EU_SETTINGS),
]);

type ProbeResult = {
  title: string;
  finalUrl: string;
  bodySnippet: string;
  candidateUrls: string[];
  verificationDetected: boolean;
  followedCareerSurface: boolean;
  navigationError?: string;
};

type DomSnapshot = {
  title: string;
  url: string;
  html: string;
  bodyText: string;
};

function mergeUniqueUrls(...groups: string[][]): string[] {
  return Array.from(new Set(groups.flat().filter(Boolean)));
}

function extractMonsterCandidateUrlsFromSource(
  source: unknown,
  currentUrl: string
): string[] {
  return withDomGlobals("<!doctype html><html><body></body></html>", currentUrl, () => {
    const candidates = collectMonsterEmbeddedCandidates(source);
    const preferred = pickRelevantJobUrls(candidates, "monster");
    if (preferred.length > 0) {
      return preferred;
    }

    return Array.from(
      new Set(
        candidates
          .filter((candidate) =>
            isLikelyJobDetailUrl(
              "monster",
              candidate.url,
              candidate.title,
              candidate.contextText
            )
          )
          .map((candidate) => candidate.url)
      )
    );
  });
}

test.skip(
  !LIVE_TESTS_ENABLED,
  "Live smoke tests are opt-in and should run only when you explicitly target real sites."
);

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", {
      configurable: true,
      get: () => undefined,
    });
  });
});

function createDom(html: string, url: string): JSDOM {
  const dom = new JSDOM(html, {
    url,
    pretendToBeVisual: true,
  });

  Object.defineProperty(dom.window.HTMLElement.prototype, "innerText", {
    configurable: true,
    get() {
      return this.textContent ?? "";
    },
    set(value: string) {
      this.textContent = value;
    },
  });

  Object.defineProperty(dom.window.HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value() {
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        bottom: 48,
        right: 240,
        width: 240,
        height: 48,
        toJSON() {
          return this;
        },
      };
    },
  });

  return dom;
}

function withDomGlobals<T>(html: string, url: string, run: () => T): T {
  const dom = createDom(html, url);
  const keys = [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "HTMLAnchorElement",
    "HTMLButtonElement",
    "HTMLInputElement",
    "HTMLSelectElement",
    "HTMLTextAreaElement",
    "Node",
    "NodeFilter",
    "Document",
    "ShadowRoot",
  ] as const;
  const saved = new Map<string, PropertyDescriptor | undefined>();

  for (const key of keys) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  }

  const replacements: Record<(typeof keys)[number], unknown> = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    HTMLAnchorElement: dom.window.HTMLAnchorElement,
    HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    HTMLSelectElement: dom.window.HTMLSelectElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    Node: dom.window.Node,
    NodeFilter: dom.window.NodeFilter,
    Document: dom.window.Document,
    ShadowRoot: dom.window.ShadowRoot,
  };

  for (const key of keys) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value: replacements[key],
    });
  }

  try {
    return run();
  } finally {
    for (const key of keys) {
      const descriptor = saved.get(key);
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor);
      } else {
        delete (globalThis as Record<string, unknown>)[key];
      }
    }
    dom.window.close();
  }
}

function extractCandidateUrlsFromHtml(
  html: string,
  url: string,
  site: SiteKey
): string[] {
  const extracted = withDomGlobals(html, url, () => {
    const candidates = collectJobDetailCandidates(site);
    return pickRelevantJobUrls(candidates, site);
  });

  if (site !== "glassdoor" || extracted.length > 0) {
    return extracted;
  }

  return mergeUniqueUrls(extracted, extractGlassdoorCandidateUrlsFromHtml(html, url));
}

const GLASSDOOR_JOB_LISTING_URL_PATTERN =
  /(?:https:\/\/www\.glassdoor\.com\/job-listing\/[^"'`\s>]+|\/job-listing\/[^"'`\s>]+)/gi;

function extractGlassdoorCandidateUrlsFromHtml(
  html: string,
  baseUrl: string
): string[] {
  return Array.from(
    new Set(
      (html.match(GLASSDOOR_JOB_LISTING_URL_PATTERN) ?? [])
        .map((match) => normalizeCapturedHtmlUrl(match, baseUrl))
        .filter((candidateUrl) =>
          Boolean(
            candidateUrl &&
              isLikelyJobDetailUrl("glassdoor", candidateUrl, "Glassdoor job")
          )
        )
    )
  );
}

function normalizeCapturedHtmlUrl(value: string, baseUrl: string): string {
  const decodedValue = value
    .replace(/&amp;/gi, "&")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#47;/gi, "/");

  try {
    return new URL(decodedValue, baseUrl).toString();
  } catch {
    return "";
  }
}

async function extractMonsterPageCandidateUrls(page: Page): Promise<string[]> {
  const currentUrl = page.url();
  const jobResults = await page.evaluate(() => {
    const searchResults = (
      window as Window & {
        searchResults?: { jobResults?: unknown[] };
      }
    ).searchResults;

    return Array.isArray(searchResults?.jobResults) ? searchResults.jobResults : [];
  });

  return extractMonsterCandidateUrlsFromSource(jobResults, currentUrl);
}

function isMonsterSearchApiUrl(url: string): boolean {
  return /jobs-svx-service\/v2\/monster\/search-jobs/i.test(url);
}

async function collectMonsterSearchApiCandidateUrls(page: Page): Promise<{
  getUrls: () => string[];
  dispose: () => void;
  settle: () => Promise<void>;
}> {
  const urls = new Set<string>();
  const pending = new Set<Promise<void>>();

  const handleResponse = (response: {
    url(): string;
    headers(): Record<string, string>;
    json(): Promise<unknown>;
  }): void => {
    if (!isMonsterSearchApiUrl(response.url())) {
      return;
    }

    const contentType =
      response.headers()["content-type"] || response.headers()["Content-Type"] || "";
    if (!/json/i.test(contentType)) {
      return;
    }

    const task = response
      .json()
      .then((payload) => {
        for (const url of extractMonsterCandidateUrlsFromSource(payload, page.url())) {
          urls.add(url);
        }
      })
      .catch(() => {})
      .finally(() => {
        pending.delete(task);
      });

    pending.add(task);
  };

  page.on("response", handleResponse);

  return {
    getUrls: () => Array.from(urls),
    dispose: () => {
      page.off("response", handleResponse);
    },
    settle: async () => {
      await Promise.allSettled(Array.from(pending));
    },
  };
}

function detectVerificationFromHtml(html: string, url: string): boolean {
  return withDomGlobals(html, url, () =>
    isProbablyHumanVerificationPage(document)
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function dismissConsentIfPresent(page: Page): Promise<void> {
  const labels = ["Accept", "Accept all", "I agree", "Got it", "Allow all"];

  for (const label of labels) {
    const button = page
      .getByRole("button", {
        name: new RegExp(`^${escapeRegExp(label)}$`, "i"),
      })
      .first();

    if (await button.isVisible().catch(() => false)) {
      await button.click().catch(() => {});
      await page.waitForTimeout(600);
      return;
    }
  }
}

async function settlePage(page: Page): Promise<void> {
  await page.waitForTimeout(SETTLE_DELAY_MS);
  await dismissConsentIfPresent(page);

  for (let index = 0; index < 3; index += 1) {
    await page.mouse.wheel(0, 1600);
    await page.waitForTimeout(800);
  }

  await page.mouse.wheel(0, -2400);
  await page.waitForTimeout(900);
  await waitForMeaningfulLiveContent(page);
}

async function waitForMeaningfulLiveContent(page: Page): Promise<void> {
  await page
    .waitForFunction(() => {
      const bodyText = (document.body?.innerText || document.body?.textContent || "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
      const iframeMetadata = Array.from(document.querySelectorAll("iframe"))
        .map((frame) =>
          [
            frame.getAttribute("title"),
            frame.getAttribute("aria-label"),
            frame.getAttribute("name"),
            frame.getAttribute("src"),
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
        )
        .join(" ");
      const anchorCount = document.querySelectorAll("a[href]").length;
      const verificationSignals = [
        "additional verification required",
        "verify you are human",
        "verification required",
        "security challenge",
        "cloudflare",
        "ray id",
        "captcha",
      ];
      const combinedText = `${bodyText} ${iframeMetadata}`;

      if (verificationSignals.some((signal) => combinedText.includes(signal))) {
        return true;
      }

      if (bodyText.includes("you need to enable javascript to run this app")) {
        return false;
      }

      return anchorCount >= 5 && bodyText.length >= 300;
    }, { timeout: 10_000 })
    .catch(() => {});
}

async function snapshotCurrentPage(page: Page): Promise<DomSnapshot> {
  const [html, meta] = await Promise.all([
    page.content(),
    page.evaluate(() => ({
      title: document.title || "",
      bodyText:
        (document.body?.innerText || document.body?.textContent || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 5000),
      url: window.location.href,
    })),
  ]);

  return {
    html,
    title: meta.title,
    bodyText: meta.bodyText,
    url: meta.url,
  };
}

async function tryOpenCareerSurface(page: Page): Promise<boolean> {
  const outcome = await page.evaluate(
    ({
      textPatterns,
      urlPatterns,
    }: {
      textPatterns: string[];
      urlPatterns: string[];
    }) => {
      const normalizeUrl = (value: string | null | undefined): string | null => {
        if (!value || value.startsWith("javascript:") || value === "#") {
          return null;
        }

        try {
          return new URL(value, window.location.href).toString();
        } catch {
          return null;
        }
      };

      const isVisible = (element: HTMLElement): boolean => {
        const styles = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          styles.display !== "none" &&
          styles.visibility !== "hidden" &&
          styles.opacity !== "0" &&
          rect.width > 0 &&
          rect.height > 0
        );
      };

      for (const frame of Array.from(
        document.querySelectorAll<HTMLIFrameElement>("iframe[src]")
      )) {
        if (!isVisible(frame)) {
          continue;
        }

        const frameUrl = normalizeUrl(frame.src || frame.getAttribute("src"));
        const title = (
          frame.getAttribute("title") ||
          frame.getAttribute("aria-label") ||
          ""
        )
          .toLowerCase()
          .trim();

        if (
          frameUrl &&
          (urlPatterns.some((token) => frameUrl.toLowerCase().includes(token)) ||
            title.includes("job") ||
            title.includes("career"))
        ) {
          return { type: "navigate" as const, url: frameUrl };
        }
      }

      const candidates: Array<{
        text: string;
        url: string | null;
        score: number;
      }> = [];

      for (const element of Array.from(
        document.querySelectorAll<HTMLElement>(
          "a[href], button, [role='button'], [data-href], [data-url], [data-link]"
        )
      )) {
        if (!isVisible(element)) {
          continue;
        }

        const text = (
          element.innerText ||
          element.textContent ||
          element.getAttribute("aria-label") ||
          element.getAttribute("title") ||
          ""
        )
          .toLowerCase()
          .replace(/\s+/g, " ")
          .trim();
        const href =
          element instanceof HTMLAnchorElement
            ? element.href
            : element.getAttribute("data-href") ||
              element.getAttribute("data-url") ||
              element.getAttribute("data-link");
        const navUrl = normalizeUrl(href);
        const hasTextSignal = textPatterns.some((token) => text.includes(token));
        const hasUrlSignal = Boolean(
          navUrl &&
            urlPatterns.some((token) => navUrl.toLowerCase().includes(token))
        );

        if (!hasTextSignal && !hasUrlSignal) {
          continue;
        }

        if (
          ["sign in", "job alert", "talent network", "saved jobs"].some(
            (token) =>
              text.includes(token) ||
              (navUrl?.toLowerCase().includes(token) ?? false)
          )
        ) {
          continue;
        }

        candidates.push({
          text,
          url: navUrl,
          score: (hasTextSignal ? 2 : 0) + (hasUrlSignal ? 1 : 0),
        });
      }

      candidates.sort(
        (left, right) =>
          right.score - left.score || left.text.localeCompare(right.text)
      );

      if (candidates[0]?.url && candidates[0].url !== window.location.href) {
        return {
          type: "navigate" as const,
          url: candidates[0].url,
        };
      }

      for (const element of Array.from(
        document.querySelectorAll<HTMLElement>("button, [role='button']")
      )) {
        if (!isVisible(element)) {
          continue;
        }

        const text = (
          element.innerText ||
          element.textContent ||
          element.getAttribute("aria-label") ||
          ""
        )
          .toLowerCase()
          .replace(/\s+/g, " ")
          .trim();

        if (!textPatterns.some((token) => text.includes(token))) {
          continue;
        }

        element.click();
        return { type: "clicked" as const };
      }

      return { type: "none" as const };
    },
    {
      textPatterns: CAREER_LISTING_TEXT_PATTERNS,
      urlPatterns: CAREER_LISTING_URL_PATTERNS,
    }
  );

  if (outcome.type === "navigate" && outcome.url) {
    await page.goto(outcome.url, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    return true;
  }

  if (outcome.type === "clicked") {
    await page.waitForTimeout(2_500);
    return true;
  }

  return false;
}

async function navigateAndCollect(
  page: Page,
  site: SiteKey,
  target: SearchTarget,
  allowCareerSurfaceDiscovery = false
): Promise<ProbeResult> {
  const monsterApiProbe =
    site === "monster" ? await collectMonsterSearchApiCandidateUrls(page) : null;

  try {
    await page.goto(target.url, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
  } catch (error) {
    monsterApiProbe?.dispose();
    return {
      title: "",
      finalUrl: target.url,
      bodySnippet: "",
      candidateUrls: [],
      verificationDetected: false,
      followedCareerSurface: false,
      navigationError:
        error instanceof Error ? error.message : String(error),
    };
  }
  await settlePage(page);

  let followedCareerSurface = false;
  const maxAttempts = allowCareerSurfaceDiscovery ? 3 : 1;
  try {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      await monsterApiProbe?.settle();
      const snapshot = await snapshotCurrentPage(page);
      const candidateUrls = extractCandidateUrlsFromHtml(
        snapshot.html,
        snapshot.url,
        site
      );
      const fallbackCandidateUrls =
        site === "monster" && candidateUrls.length === 0
          ? mergeUniqueUrls(
              await extractMonsterPageCandidateUrls(page),
              monsterApiProbe?.getUrls() ?? []
            )
          : candidateUrls;
      const verificationDetected = detectVerificationFromHtml(
        snapshot.html,
        snapshot.url
      );
      const isDirectJobDetail =
        allowCareerSurfaceDiscovery &&
        (site === "startup" || site === "other_sites") &&
        isLikelyJobDetailUrl(site, snapshot.url, snapshot.title, snapshot.bodyText);

      if (
        fallbackCandidateUrls.length > 0 ||
        isDirectJobDetail ||
        verificationDetected ||
        !allowCareerSurfaceDiscovery
      ) {
        return {
          title: snapshot.title,
          finalUrl: snapshot.url,
          bodySnippet: snapshot.bodyText,
          candidateUrls: isDirectJobDetail ? [snapshot.url] : fallbackCandidateUrls,
          verificationDetected,
          followedCareerSurface,
        };
      }

      const openedCareerSurface = await tryOpenCareerSurface(page);
      if (!openedCareerSurface) {
        return {
          title: snapshot.title,
          finalUrl: snapshot.url,
          bodySnippet: snapshot.bodyText,
          candidateUrls: fallbackCandidateUrls,
          verificationDetected,
          followedCareerSurface,
        };
      }

      followedCareerSurface = true;
      await settlePage(page);
    }

    const snapshot = await snapshotCurrentPage(page);
    return {
      title: snapshot.title,
      finalUrl: snapshot.url,
      bodySnippet: snapshot.bodyText,
      candidateUrls:
        site === "monster"
          ? mergeUniqueUrls(
              extractCandidateUrlsFromHtml(snapshot.html, snapshot.url, site),
              await extractMonsterPageCandidateUrls(page),
              monsterApiProbe?.getUrls() ?? []
            )
          : extractCandidateUrlsFromHtml(snapshot.html, snapshot.url, site),
      verificationDetected: detectVerificationFromHtml(snapshot.html, snapshot.url),
      followedCareerSurface,
    };
  } catch (error) {
    const currentUrl =
      typeof page.url === "function" && !page.isClosed() ? page.url() : target.url;
    return {
      title: "",
      finalUrl: currentUrl,
      bodySnippet: "",
      candidateUrls: [],
      verificationDetected: false,
      followedCareerSurface,
      navigationError: error instanceof Error ? error.message : String(error),
    };
  } finally {
    monsterApiProbe?.dispose();
  }
}

function describeProbeFailure(target: SearchTarget, probe: ProbeResult): string {
  return [
    `target=${target.label}`,
    `url=${probe.finalUrl}`,
    `title=${probe.title || "(empty)"}`,
    `candidates=${probe.candidateUrls.length}`,
    `verification=${probe.verificationDetected}`,
    `followedCareerSurface=${probe.followedCareerSurface}`,
    `navigationError=${probe.navigationError || "(none)"}`,
    `body=${probe.bodySnippet.slice(0, 400) || "(empty)"}`,
  ].join("\n");
}

function isLikelyNoOpeningsPage(probe: ProbeResult): boolean {
  const text = `${probe.title} ${probe.bodySnippet}`
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

  return [
    /\b0 jobs found\b/,
    /\bno jobs found\b/,
    /\bno open positions\b/,
    /\bno open roles\b/,
    /\bno current openings\b/,
    /\bno current opportunities\b/,
    /\bno vacancies\b/,
    /\bsorry, no results at the moment\b/,
    /\bthere are currently no jobs available\b/,
    /\bthere are currently no open positions\b/,
    /\bcheck back again soon\b/,
  ].some((pattern) => pattern.test(text));
}

function isLikelyJavascriptShellPage(probe: ProbeResult): boolean {
  const text = `${probe.title} ${probe.bodySnippet}`
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

  return [
    /\byou need to enable javascript to run this app\b/,
    /\benable javascript to continue\b/,
    /\bjavascript is required\b/,
    /\bplease enable javascript\b/,
  ].some((pattern) => pattern.test(text));
}

for (const target of buildSearchTargets("indeed", "https://www.indeed.com", "software engineer")) {
  test(`live Indeed search works: ${target.label}`, async ({ page }) => {
    const probe = await navigateAndCollect(page, "indeed", target);

    test.skip(
      Boolean(probe.navigationError),
      `Indeed target could not be reached.\n${describeProbeFailure(target, probe)}`
    );
    test.skip(
      probe.verificationDetected,
      `Indeed blocked automated browsing with a verification page.\n${describeProbeFailure(target, probe)}`
    );
    expect(
      probe.candidateUrls.length,
      `Indeed search produced no job-detail candidates.\n${describeProbeFailure(target, probe)}`
    ).toBeGreaterThan(0);
  });
}

for (const target of buildSearchTargets("monster", "https://www.monster.com", "software engineer")) {
  test(`live Monster search works: ${target.label}`, async ({ page }) => {
    const probe = await navigateAndCollect(page, "monster", target);

    expect(
      probe.navigationError,
      `Monster target could not be reached.\n${describeProbeFailure(target, probe)}`
    ).toBeFalsy();
    expect(
      probe.verificationDetected,
      `Monster blocked automated browsing with a verification page.\n${describeProbeFailure(target, probe)}`
    ).toBe(false);
    expect(
      probe.candidateUrls.length,
      `Monster search produced no job-detail candidates.\n${describeProbeFailure(target, probe)}`
    ).toBeGreaterThan(0);
  });
}

for (const target of buildSearchTargets("ziprecruiter", "https://www.ziprecruiter.com", "software engineer")) {
  test(`live ZipRecruiter search works: ${target.label}`, async ({ page }) => {
    const probe = await navigateAndCollect(page, "ziprecruiter", target);

    test.skip(
      Boolean(probe.navigationError),
      `ZipRecruiter target could not be reached.\n${describeProbeFailure(target, probe)}`
    );
    test.skip(
      probe.verificationDetected,
      `ZipRecruiter challenge page detected.\n${describeProbeFailure(target, probe)}`
    );
    expect(
      probe.candidateUrls.length,
      `ZipRecruiter search produced no job-detail candidates.\n${describeProbeFailure(target, probe)}`
    ).toBeGreaterThan(0);
  });
}

for (const target of buildSearchTargets("dice", "https://www.dice.com", "software engineer")) {
  test(`live Dice search works: ${target.label}`, async ({ page }) => {
    const probe = await navigateAndCollect(page, "dice", target);

    test.skip(
      Boolean(probe.navigationError),
      `Dice target could not be reached.\n${describeProbeFailure(target, probe)}`
    );
    test.skip(
      probe.verificationDetected,
      `Dice challenge page detected.\n${describeProbeFailure(target, probe)}`
    );
    expect(
      probe.candidateUrls.length,
      `Dice search produced no job-detail candidates.\n${describeProbeFailure(target, probe)}`
    ).toBeGreaterThan(0);
  });
}

for (const target of buildSearchTargets("glassdoor", "https://www.glassdoor.com", "software engineer")) {
  test(`live Glassdoor search works: ${target.label}`, async ({ page }) => {
    const probe = await navigateAndCollect(page, "glassdoor", target);

    test.skip(
      Boolean(probe.navigationError),
      `Glassdoor target could not be reached.\n${describeProbeFailure(target, probe)}`
    );
    test.skip(
      probe.verificationDetected,
      `Glassdoor blocked automated browsing with a verification page.\n${describeProbeFailure(target, probe)}`
    );
    expect(
      probe.candidateUrls.length,
      `Glassdoor search produced no job-detail candidates.\n${describeProbeFailure(target, probe)}`
    ).toBeGreaterThan(0);
  });
}

for (const target of buildSearchTargets("builtin", "https://builtin.com", "software engineer")) {
  test(`live Built In search works: ${target.label}`, async ({ page }) => {
    const probe = await navigateAndCollect(page, "builtin", target);

    test.skip(
      Boolean(probe.navigationError),
      `Built In target could not be reached.\n${describeProbeFailure(target, probe)}`
    );
    test.skip(
      probe.verificationDetected,
      `Built In blocked automated browsing with a verification page.\n${describeProbeFailure(target, probe)}`
    );
    expect(
      probe.candidateUrls.length,
      `Built In search produced no job-detail candidates.\n${describeProbeFailure(target, probe)}`
    ).toBeGreaterThan(0);
  });
}

for (const target of buildSearchTargets(
  "greenhouse",
  "https://job-boards.greenhouse.io/vercel",
  "engineer"
)) {
  test(`live Greenhouse search works: ${target.label}`, async ({ page }) => {
    const probe = await navigateAndCollect(page, "greenhouse", target);

    test.skip(
      Boolean(probe.navigationError),
      `Greenhouse target could not be reached.\n${describeProbeFailure(target, probe)}`
    );
    test.skip(
      probe.verificationDetected,
      `Greenhouse blocked automated browsing with a verification page.\n${describeProbeFailure(target, probe)}`
    );
    expect(
      probe.candidateUrls.length,
      `Greenhouse search produced no job-detail candidates.\n${describeProbeFailure(target, probe)}`
    ).toBeGreaterThan(0);
  });
}

for (const target of STARTUP_TARGETS) {
  test(`live startup search surface works: ${target.label}`, async ({ page }) => {
    const probe = await navigateAndCollect(page, "startup", target, true);

    test.skip(
      Boolean(probe.navigationError),
      `Startup target could not be reached.\n${describeProbeFailure(target, probe)}`
    );
    test.skip(
      probe.verificationDetected,
      `Startup target hit a challenge page.\n${describeProbeFailure(target, probe)}`
    );
    test.skip(
      probe.candidateUrls.length === 0 && isLikelyNoOpeningsPage(probe),
      `Startup target currently shows no open jobs.\n${describeProbeFailure(target, probe)}`
    );
    test.skip(
      probe.candidateUrls.length === 0 && isLikelyJavascriptShellPage(probe),
      `Startup target currently exposes only a JavaScript-required shell.\n${describeProbeFailure(target, probe)}`
    );
    expect(
      probe.candidateUrls.length,
      `Startup target exposed no discoverable job-detail candidates.\n${describeProbeFailure(target, probe)}`
    ).toBeGreaterThan(0);
  });
}

for (const target of OTHER_SITE_TARGETS) {
  test(`live other-site search works: ${target.label}`, async ({ page }) => {
    const probe = await navigateAndCollect(page, "other_sites", target, true);

    test.skip(
      Boolean(probe.navigationError),
      `Other-site target could not be reached.\n${describeProbeFailure(target, probe)}`
    );
    test.skip(
      probe.verificationDetected,
      `Other-site target hit a challenge page.\n${describeProbeFailure(target, probe)}`
    );
    test.skip(
      probe.candidateUrls.length === 0 && isLikelyNoOpeningsPage(probe),
      `Other-site target currently shows no open jobs.\n${describeProbeFailure(target, probe)}`
    );
    test.skip(
      probe.candidateUrls.length === 0 && isLikelyJavascriptShellPage(probe),
      `Other-site target currently exposes only a JavaScript-required shell.\n${describeProbeFailure(target, probe)}`
    );
    expect(
      probe.candidateUrls.length,
      `Other-site target exposed no job-detail candidates.\n${describeProbeFailure(target, probe)}`
    ).toBeGreaterThan(0);
  });
}
