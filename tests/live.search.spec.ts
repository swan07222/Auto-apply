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
  candidate: {
    ...DEFAULT_SETTINGS.candidate,
    country: "United States",
  },
};

const UK_SETTINGS = {
  ...DEFAULT_SETTINGS,
  startupRegion: "uk" as const,
  candidate: {
    ...DEFAULT_SETTINGS.candidate,
    country: "United Kingdom",
  },
};

const EU_SETTINGS = {
  ...DEFAULT_SETTINGS,
  startupRegion: "eu" as const,
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
};

type DomSnapshot = {
  title: string;
  url: string;
  html: string;
  bodyText: string;
};

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
    "Node",
    "Document",
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
    Node: dom.window.Node,
    Document: dom.window.Document,
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
  return withDomGlobals(html, url, () => {
    const candidates = collectJobDetailCandidates(site);
    return pickRelevantJobUrls(candidates, site);
  });
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

  return withDomGlobals("<!doctype html><html><body></body></html>", currentUrl, () =>
    pickRelevantJobUrls(collectMonsterEmbeddedCandidates(jobResults), "monster")
  );
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
      const anchorCount = document.querySelectorAll("a[href]").length;
      const verificationSignals = [
        "additional verification required",
        "verify you are human",
        "verification required",
        "security challenge",
        "cloudflare",
        "ray id",
      ];

      if (verificationSignals.some((signal) => bodyText.includes(signal))) {
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
  await page.goto(target.url, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await settlePage(page);

  let followedCareerSurface = false;
  const maxAttempts = allowCareerSurfaceDiscovery ? 3 : 1;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const snapshot = await snapshotCurrentPage(page);
    const candidateUrls = extractCandidateUrlsFromHtml(
      snapshot.html,
      snapshot.url,
      site
    );
    const fallbackCandidateUrls =
      site === "monster" && candidateUrls.length === 0
        ? await extractMonsterPageCandidateUrls(page)
        : candidateUrls;
    const verificationDetected = detectVerificationFromHtml(
      snapshot.html,
      snapshot.url
    );

    if (
      fallbackCandidateUrls.length > 0 ||
      verificationDetected ||
      !allowCareerSurfaceDiscovery
    ) {
      return {
        title: snapshot.title,
        finalUrl: snapshot.url,
        bodySnippet: snapshot.bodyText,
        candidateUrls: fallbackCandidateUrls,
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
    candidateUrls: extractCandidateUrlsFromHtml(snapshot.html, snapshot.url, site),
    verificationDetected: detectVerificationFromHtml(snapshot.html, snapshot.url),
    followedCareerSurface,
  };
}

function describeProbeFailure(target: SearchTarget, probe: ProbeResult): string {
  return [
    `target=${target.label}`,
    `url=${probe.finalUrl}`,
    `title=${probe.title || "(empty)"}`,
    `candidates=${probe.candidateUrls.length}`,
    `verification=${probe.verificationDetected}`,
    `followedCareerSurface=${probe.followedCareerSurface}`,
    `body=${probe.bodySnippet.slice(0, 400) || "(empty)"}`,
  ].join("\n");
}

for (const target of buildSearchTargets("indeed", "https://www.indeed.com", "software engineer")) {
  test(`live Indeed search works: ${target.label}`, async ({ page }) => {
    const probe = await navigateAndCollect(page, "indeed", target);

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

    test.skip(
      probe.verificationDetected,
      `Monster blocked automated browsing with a verification page.\n${describeProbeFailure(target, probe)}`
    );
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
      probe.verificationDetected,
      `Glassdoor blocked automated browsing with a verification page.\n${describeProbeFailure(target, probe)}`
    );
    expect(
      probe.candidateUrls.length,
      `Glassdoor search produced no job-detail candidates.\n${describeProbeFailure(target, probe)}`
    ).toBeGreaterThan(0);
  });
}

for (const target of STARTUP_TARGETS) {
  test(`live startup search surface works: ${target.label}`, async ({ page }) => {
    const probe = await navigateAndCollect(page, "startup", target, true);

    test.skip(
      probe.verificationDetected,
      `Startup target hit a challenge page.\n${describeProbeFailure(target, probe)}`
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
      probe.verificationDetected,
      `Other-site target hit a challenge page.\n${describeProbeFailure(target, probe)}`
    );
    expect(
      probe.candidateUrls.length,
      `Other-site target exposed no job-detail candidates.\n${describeProbeFailure(target, probe)}`
    ).toBeGreaterThan(0);
  });
}
