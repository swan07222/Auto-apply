// src/content/jobSearch.ts
// COMPLETE FILE — replace entirely

import { DatePostedWindow, ResumeKind, SiteKey, getJobDedupKey } from "../shared";
import { JobCandidate } from "./types";
import { cleanText, normalizeChoiceText } from "./text";
import { normalizeUrl } from "./dom";
import {
  CAREER_LISTING_TEXT_PATTERNS,
  JOB_DETAIL_ATS_URL_TOKENS,
  buildHrefContainsSelectors,
  hasJobDetailAtsUrl,
  hasKnownAtsHost,
} from "./sitePatterns";

const JOB_DETAIL_QUERY_PARAMS = [
  "gh_jid",
  "jid",
  "jobid",
  "job_id",
  "posting_id",
  "reqid",
  "req_id",
  "requisitionid",
  "requisition_id",
  "ashby_jid",
  "lever-source",
];

const GENERIC_ROLE_CTA_TEXTS = [
  "apply",
  "apply now",
  "apply here",
  "learn more",
  "read more",
  "details",
  "job details",
  "more details",
  "view details",
  "view role",
  "see role",
  "view position",
  "see position",
  "view opening",
  "see opening",
];

const CAREER_LISTING_CTA_TEXTS = Array.from(
  new Set([
    ...CAREER_LISTING_TEXT_PATTERNS,
    "see all jobs",
    "see all openings",
    "see our jobs",
    "view open roles",
  ])
);

const STARTUP_OTHER_SITE_LINK_SELECTORS = Array.from(
  new Set([
    "a[href*='/jobs/']",
    "a[href*='/job/']",
    "a[href*='/role/']",
    "a[href*='/roles/']",
    "a[href*='/positions/']",
    "a[href*='/position/']",
    "a[href*='/opportunity/']",
    "a[href*='/opportunities/']",
    "a[href*='/careers/']",
    "a[href*='/career/']",
    "a[href*='/openings/']",
    "a[href*='/opening/']",
    "a[href*='/vacancies/']",
    "a[href*='/vacancy/']",
    "a[href*='/job-posting/']",
    "a[href*='/job-postings/']",
    "a[href*='/requisition/']",
    "a[href*='/req/']",
    ...buildHrefContainsSelectors(JOB_DETAIL_ATS_URL_TOKENS),
  ])
);

export function collectJobDetailCandidates(site: SiteKey): JobCandidate[] {
  switch (site) {
    case "indeed":
      return dedupeJobCandidates([
        ...collectCandidatesFromContainers(
          [
            "[data-jk]",
            "[data-testid='slider_item']",
            ".job_seen_beacon",
            ".resultContent",
            ".jobsearch-ResultsList li",
            "li",
          ],
          [
            "a.jcs-JobTitle",
            "h2 a[href]",
            "a[href*='/viewjob']",
            "a[href*='/rc/clk']",
            "a[href*='/pagead/clk']",
            "a[href*='/company/']",
          ],
          ["h2", "[title]", ".jobTitle"]
        ),
        ...collectCandidatesFromAnchors([
          "a.jcs-JobTitle",
          "a[href*='/viewjob']",
          "a[href*='/rc/clk']",
          "a[href*='/pagead/clk']",
          "[data-jk] a[href]",
        ]),
      ]);

    case "ziprecruiter":
      return dedupeJobCandidates([
        ...collectCandidatesFromContainers(
          [
            "[data-testid*='job-card']",
            "[data-testid*='job']",
            "[class*='job_result']",
            "[class*='jobList']",
            "[class*='job-listing']",
            "[class*='JobListing']",
            "[class*='job_content']",
            "[class*='JobContent']",
            "article",
            "section",
            "li",
          ],
          [
            "a[href*='/jobs/' i]",
            "a[href*='/job/' i]",
            "a[href*='/job-details/' i]",
            "a[href*='/k/' i]",
            "a[href*='jid=' i]",
            "a[href*='/c/' i][href*='/job/' i]",
            "a[data-testid*='job-title']",
            "a[data-testid='job-title']",
            "a[class*='job']",
            "a[class*='job_link']",
            // FIX: Additional ZipRecruiter anchor patterns
            "a[href*='/t-']",
            "a[href*='mid=']",
          ],
          [
            "h1",
            "h2",
            "h3",
            "[data-testid*='job-title']",
            "[class*='job_title']",
            "[class*='jobTitle']",
            "[class*='job-title']",
          ]
        ),
        ...collectCandidatesFromAnchors([
          "a[href*='/jobs/' i]",
          "a[href*='/job/' i]",
          "a[href*='/job-details/' i]",
          "a[href*='/k/' i]",
          "a[href*='jid=' i]",
          "a[href*='/c/' i][href*='/job/' i]",
          "a[data-testid*='job-title']",
          "a[data-testid='job-title']",
          "a[href*='/t-']",
        ]),
        ...collectZipRecruiterCardCandidates(),
        // FIX: Also collect from data attributes that contain job IDs
        ...collectZipRecruiterDataAttributeCandidates(),
      ]);

    case "dice":
      return dedupeJobCandidates([
        // FIX: Dice uses custom web components — collect from shadow DOM
        ...collectDiceSearchCardCandidates(),
        ...collectCandidatesFromAnchors([
          "a[href*='/job-detail/']",
          "a[href*='/jobs/detail/']",
          "a[data-cy*='job']",
          "a[data-id]",
          // FIX: Additional Dice selectors
          "a.card-title-link",
          "a[class*='card-title']",
          "a[class*='job-title']",
          "a[data-testid*='job']",
        ]),
        ...collectCandidatesFromContainers(
          [
            "[data-cy*='search-card']",
            "[data-testid*='search-card']",
            "[class*='search-card']",
            "[class*='SearchCard']",
            "[class*='job-card']",
            "[class*='JobCard']",
            ".dhi-search-cards-widget .card",
            "article",
            "li",
          ],
          [
            "a[href*='/job-detail/']",
            "a[href*='/jobs/detail/']",
            "a[data-cy*='job']",
            "a.card-title-link",
            "a[class*='card-title']",
            "a[class*='job-title']",
          ],
          [
            "h1",
            "h2",
            "h3",
            "h5",
            "[data-cy*='title']",
            "[class*='card-title']",
            "[class*='job-title']",
            "[class*='jobTitle']",
            "a.card-title-link",
          ]
        ),
      ]);

    case "monster":
      return dedupeJobCandidates([
        ...collectCandidatesFromContainers(
          [
            "[data-testid*='job']",
            "[data-testid='job-card']",
            "[data-testid='JobCard']",
            "[class*='job-card']",
            "[class*='JobCard']",
            "[class*='job_card']",
            "[class*='job-result']",
            "[class*='JobResult']",
            "[class*='search-result']",
            "[class*='card-content']",
            "[class*='results-card']",
            "[class*='job-cardstyle']",
            "[class*='JobCardStyle']",
            "[class*='flip-card']",
            "[class*='job-search-resultsstyle']",
            "[class*='job-search-result']",
            "[class*='JobSearchResult']",
            "[class*='job-list-item']",
            "[class*='JobListItem']",
            "article",
            "section",
            "li",
          ],
          [
            "a[href*='/job-openings/']",
            "a[href*='/job-opening/']",
            "a[href*='monster.com/job/']",
            "a[href*='monster.com/jobs/']",
            "a[href*='/job-detail/']",
            "a[href*='/jobs/l-']",
            "a[href*='/jobs/q-']",
            "a[href*='job-openings.monster.com']",
            "a[href*='jobview.monster.com']",
            "a[data-testid*='job']",
            "a[data-testid='jobTitle']",
            "a[data-testid='job-title']",
            "a[class*='job']",
            "a[class*='title']",
            "a[data-bypass]",
            "a[href*='?jobid=']",
            "a[href*='job_id=']",
            "a[href*='monster'][href*='/job']",
          ],
          [
            "h1",
            "h2",
            "h3",
            "h4",
            "[data-testid*='job-title']",
            "[data-testid='jobTitle']",
            "[data-testid*='title']",
            "[class*='title']",
            "[class*='job-title']",
            "[class*='jobTitle']",
            "[class*='job-name']",
            "[class*='JobName']",
          ]
        ),
        ...collectCandidatesFromAnchors([
          "a[href*='/job-openings/']",
          "a[href*='/job-opening/']",
          "a[href*='monster.com/job/']",
          "a[href*='monster.com/jobs/']",
          "a[href*='/job-detail/']",
          "a[href*='/jobs/l-']",
          "a[href*='/jobs/q-']",
          "a[href*='job-openings.monster.com']",
          "a[href*='jobview.monster.com']",
          "a[data-testid*='job']",
          "a[data-testid='jobTitle']",
          "a[data-testid='job-title']",
          "a[href*='?jobid=']",
          "a[href*='job_id=']",
        ]),
        ...collectMonsterFallbackCandidates(),
      ]);

    case "startup":
    case "other_sites":
      return dedupeJobCandidates([
        ...collectCandidatesFromContainers(
          [
            "[data-qa*='job']",
            "[data-testid*='job']",
            "[data-test*='job']",
            "[class*='job']",
            "[class*='position']",
            "[class*='opening']",
            "[class*='posting']",
            "[class*='role']",
            "[class*='vacancy']",
            "[class*='listing']",
            "[class*='opportunity']",
            "[class*='career']",
            "[class*='Career']",
            "[class*='openings']",
            "[class*='Openings']",
            "article",
            "section",
            "li",
          ],
          STARTUP_OTHER_SITE_LINK_SELECTORS,
          ["h1", "h2", "h3", "h4", "[data-testid*='title']", "[class*='title']"]
        ),
        ...collectCandidatesFromAnchors(STARTUP_OTHER_SITE_LINK_SELECTORS),
        ...collectFallbackJobCandidates(),
      ]);

    case "chatgpt":
      return [];
  }
}

export function collectMonsterEmbeddedCandidates(source: unknown): JobCandidate[] {
  const jobResults = Array.isArray(source)
    ? source
    : typeof source === "object" &&
        source !== null &&
        Array.isArray((source as { jobResults?: unknown[] }).jobResults)
      ? (source as { jobResults: unknown[] }).jobResults
      : [];
  const candidates: JobCandidate[] = [];

  for (const jobResult of jobResults) {
    if (typeof jobResult !== "object" || jobResult === null) {
      continue;
    }

    const record = jobResult as {
      canonicalUrl?: unknown;
      dateRecency?: unknown;
      enrichments?: {
        localizedMonsterUrls?: Array<{ url?: unknown }>;
        processedDescriptions?: { shortDescription?: unknown };
      };
      jobPosting?: {
        hiringOrganization?: { name?: unknown };
        title?: unknown;
        url?: unknown;
      };
      location?: {
        displayText?: unknown;
        displayTextJobCard?: unknown;
      };
      normalizedJobPosting?: {
        hiringOrganization?: { name?: unknown };
        title?: unknown;
        url?: unknown;
      };
    };

    const url =
      stringOrEmpty(record.normalizedJobPosting?.url) ||
      stringOrEmpty(record.jobPosting?.url) ||
      stringOrEmpty(record.enrichments?.localizedMonsterUrls?.[0]?.url) ||
      stringOrEmpty(record.canonicalUrl);
    const title =
      stringOrEmpty(record.normalizedJobPosting?.title) ||
      stringOrEmpty(record.jobPosting?.title);
    const contextText = cleanText(
      [
        stringOrEmpty(record.normalizedJobPosting?.hiringOrganization?.name) ||
          stringOrEmpty(record.jobPosting?.hiringOrganization?.name),
        stringOrEmpty(record.location?.displayText) ||
          stringOrEmpty(record.location?.displayTextJobCard),
        stringOrEmpty(record.dateRecency),
        stringOrEmpty(record.enrichments?.processedDescriptions?.shortDescription),
      ]
        .filter(Boolean)
        .join(" ")
    );

    addJobCandidate(candidates, url, title, contextText);
  }

  return dedupeJobCandidates(candidates);
}

export function pickRelevantJobUrls(
  candidates: JobCandidate[],
  site: SiteKey | null,
  resumeKind?: ResumeKind,
  datePostedWindow: DatePostedWindow = "any"
): string[] {
  const valid = candidates.filter((candidate) =>
    isLikelyJobDetailUrl(site, candidate.url, candidate.title, candidate.contextText)
  );

  const recencyFiltered = filterCandidatesByDatePostedWindow(valid, datePostedWindow);
  const eligible = datePostedWindow === "any" ? valid : recencyFiltered;

  if (!resumeKind) {
    return sortCandidatesByRecency(eligible, datePostedWindow).map((candidate) => candidate.url);
  }

  const fallbackPool =
    site === "startup" || site === "other_sites"
      ? eligible.filter((candidate) => looksLikeTechnicalRoleTitle(candidate.title))
      : eligible;

  const scored = fallbackPool.map((candidate, index) => ({
    candidate,
    index,
    score: scoreJobTitleForResume(candidate.title, resumeKind),
    ageHours: extractPostedAgeHours(candidate.contextText),
  }));

  const preferred = scored
    .filter((entry) => entry.score > 0)
    .sort((a, b) =>
      b.score - a.score ||
      comparePostedAgeHours(a.ageHours, b.ageHours, datePostedWindow) ||
      a.index - b.index
    )
    .map((entry) => entry.candidate.url);

  if (preferred.length === 0) {
    return sortCandidatesByRecency(fallbackPool, datePostedWindow).map((candidate) => candidate.url);
  }

  const preferredSet = new Set(preferred);
  const fallback = sortCandidatesByRecency(fallbackPool, datePostedWindow)
    .map((candidate) => candidate.url)
    .filter((url) => !preferredSet.has(url));

  return [...preferred, ...fallback];
}

export function isLikelyJobDetailUrl(
  site: SiteKey | null,
  url: string,
  text: string,
  contextText = ""
): boolean {
  if (!site) {
    return false;
  }

  const lowerUrl = url.toLowerCase();
  const lowerText = text.toLowerCase();
  const lowerContext = contextText.toLowerCase();

  if (
    [
      "salary",
      "resume",
      "privacy",
      "terms",
      "sign in",
      "post a job",
      "employer",
      "job alert",
      "saved jobs",
    ].some((token) => lowerText.includes(token))
  ) {
    return false;
  }

  if (isAppliedJobText(lowerText) || isAppliedJobText(lowerContext)) {
    return false;
  }

  switch (site) {
    case "indeed":
      return (
        lowerUrl.includes("/viewjob") ||
        lowerUrl.includes("/rc/clk") ||
        lowerUrl.includes("/pagead/clk")
      );

    // FIX: Completely rewritten ZipRecruiter URL matching
    case "ziprecruiter": {
      // Search-result detail pages can still use the jobs-search route
      // while pinning a specific job with lk/jid.
      if (/[?&]jid=/i.test(lowerUrl)) return true;
      if (/[?&]lk=/i.test(lowerUrl)) return true;

      // Exclude search/category pages
      if (
        lowerUrl.includes("/jobs-search") ||
        lowerUrl.includes("/candidate/") ||
        lowerUrl.includes("/post-a-job") ||
        lowerUrl.includes("/salaries/") ||
        /\/jobs\/?$/i.test(lowerUrl) ||
        /\/jobs\?(?!.*(?:jid|lk)=)/i.test(lowerUrl)
      ) {
        return false;
      }

      // Explicit job detail patterns
      if (lowerUrl.includes("/job-details/")) return true;

      // Path-based patterns: /k/HASH, /c/Company/job/Title
      if (/\/k\/[^/?#]+/i.test(lowerUrl)) return true;
      if (/\/c\/[^/]+\/job\//i.test(lowerUrl)) return true;

      // /jobs/ with a specific slug (not just /jobs/ or /jobs?search=)
      if (/ziprecruiter\.[a-z.]+\/jobs\/[^/?#]{4,}/i.test(lowerUrl)) {
        if (
          !lowerUrl.includes("/jobs/search") &&
          !lowerUrl.includes("/jobs/browse")
        ) {
          return true;
        }
      }

      // /t-Title/l-Location pattern
      if (/\/t-[^/?#]+/i.test(lowerUrl) && lowerUrl.includes("ziprecruiter")) {
        return true;
      }

      return false;
    }

    // FIX: Expanded Dice URL matching
    case "dice": {
      if (lowerUrl.includes("/job-detail/")) return true;
      if (lowerUrl.includes("/jobs/detail/")) return true;

      // Dice job URLs often have UUIDs
      if (/dice\.com\/.*\/[a-f0-9-]{8,}/i.test(lowerUrl)) {
        // Exclude search/filter pages
        if (
          lowerUrl.includes("/jobs?") ||
          /\/jobs\/?$/i.test(lowerUrl) ||
          lowerUrl.includes("/jobs/q-")
        ) {
          return false;
        }
        return true;
      }

      // data-id based links
      if (lowerUrl.includes("dice.com") && /\/[a-f0-9]{24,}/i.test(lowerUrl)) {
        return true;
      }

      return false;
    }

    case "monster": {
      if (
        /\/jobs\/?$/i.test(lowerUrl) ||
        lowerUrl.includes("/jobs/search") ||
        lowerUrl.includes("/jobs/browse") ||
        lowerUrl.includes("/salary/") ||
        lowerUrl.includes("/career-advice/") ||
        lowerUrl.includes("/company/") ||
        lowerUrl.includes("/profile/") ||
        lowerUrl.includes("/account/")
      ) {
        return false;
      }

      if (
        lowerUrl.includes("/job-openings/") ||
        lowerUrl.includes("/job-opening/") ||
        lowerUrl.includes("/job-detail/") ||
        lowerUrl.includes("job-openings.monster.com/") ||
        lowerUrl.includes("jobview.monster.com") ||
        lowerUrl.includes("m=portal&a=details") ||
        /[?&]jobid=/i.test(lowerUrl) ||
        /[?&]job_id=/i.test(lowerUrl)
      ) {
        return true;
      }

      if (/monster\.[a-z.]+\/job\/[^/?#]+/i.test(lowerUrl)) {
        return true;
      }

      if (/monster\.[a-z.]+\/jobs\/[^/?#]+/i.test(lowerUrl)) {
        if (
          lowerUrl.includes("/jobs/search") ||
          lowerUrl.includes("/jobs/browse") ||
          lowerUrl.includes("/jobs/q-") ||
          lowerUrl.includes("/jobs/l-")
        ) {
          return false;
        }

        try {
          const parsed = new URL(lowerUrl);
          const pathParts = parsed.pathname.split("/").filter(Boolean);
          if (pathParts.length >= 2 && pathParts[1].length > 3) {
            return true;
          }
        } catch {
          // Fall through
        }
      }

      if (/monster\.[a-z.]+\/.*\/[a-f0-9-]{8,}/i.test(lowerUrl)) {
        return true;
      }

      return false;
    }

    case "startup":
    case "other_sites": {
      try {
        const parsed = new URL(lowerUrl);
        if (hasJobIdentifyingSearchParam(parsed)) {
          return true;
        }
        if (isKnownAtsListingUrl(parsed)) {
          return false;
        }
        if (hasJobDetailAtsUrl(lowerUrl)) {
          return true;
        }
      } catch {
        // Ignore parse errors
      }

      if (isListingOrCategoryUrl(lowerUrl)) {
        return false;
      }

      const pathSignals = [
        "/jobs/",
        "/job/",
        "/role/",
        "/roles/",
        "/positions/",
        "/position/",
        "/opportunity/",
        "/opportunities/",
        "/openings/",
        "/opening/",
        "/vacancies/",
        "/vacancy/",
        "/job-posting/",
        "/job-postings/",
        "/requisition/",
        "/req/",
      ];

      if (pathSignals.some((token) => lowerUrl.includes(token))) {
        try {
          const parsed = new URL(lowerUrl);
          const path = parsed.pathname.toLowerCase().replace(/\/+$/, "");
          const segments = path.split("/").filter(Boolean);
          const lastSegment = segments[segments.length - 1] ?? "";

          for (const signal of pathSignals) {
            const trimmedSignal = signal.replace(/\//g, "");
            const signalIndex = segments.indexOf(trimmedSignal);
            if (
              signalIndex >= 0 &&
              signalIndex < segments.length - 1 &&
              !isGenericListingSegment(lastSegment)
            ) {
              return true;
            }
          }

          if (hasJobIdentifyingSearchParam(parsed)) {
            return true;
          }

          return (
            !isGenericListingSegment(lastSegment) &&
            looksLikeTechnicalRoleTitle(text)
          );
        } catch {
          // Fall through
        }
        return !isListingOrCategoryUrl(lowerUrl) && looksLikeTechnicalRoleTitle(text);
      }

      const hasCareerPath = lowerUrl.includes("/careers/") || lowerUrl.includes("/career/");
      if (hasCareerPath) {
        try {
          const parsed = new URL(lowerUrl);
          const path = parsed.pathname.toLowerCase().replace(/\/+$/, "");
          const segments = path.split("/").filter(Boolean);
          const lastSegment = segments[segments.length - 1] ?? "";
          if (segments.length >= 2 && !isGenericListingSegment(lastSegment)) {
            return true;
          }
        } catch {
          // Ignore
        }

        return looksLikeTechnicalRoleTitle(text);
      }

      try {
        const parsed = new URL(lowerUrl);
        const path = parsed.pathname.toLowerCase().replace(/\/+$/, "");
        const segments = path.split("/").filter(Boolean);
        const lastSegment = segments[segments.length - 1] ?? "";
        const looksLikeDetailSlug =
          lastSegment.includes("-") ||
          /\d/.test(lastSegment) ||
          segments.length >= 3;

        if (
          segments.length >= 2 &&
          looksLikeDetailSlug &&
          !isGenericListingSegment(lastSegment) &&
          looksLikeTechnicalRoleTitle(text)
        ) {
          return true;
        }
      } catch {
        // Ignore
      }

      return false;
    }

    case "chatgpt":
      return false;
  }
}

export function looksLikeTechnicalRoleTitle(text: string): boolean {
  const normalized = normalizeChoiceText(text);

  if (!normalized) {
    return false;
  }

  return [
    "software engineer",
    "engineer",
    "developer",
    "front end",
    "frontend",
    "back end",
    "backend",
    "full stack",
    "fullstack",
    "web",
    "platform",
    "api",
    "devops",
    "sre",
    "site reliability",
    "qa",
    "test automation",
    "react",
    "angular",
    "vue",
    "node",
    "python",
    "java",
    "golang",
    "rust",
    "typescript",
    "javascript",
    "infrastructure",
    "cloud",
    "data engineer",
    "machine learning",
    "mobile",
    "ios",
    "android",
    "security",
    "architect",
    "systems",
    "embedded",
    "firmware",
    "network",
    "product engineer",
    "staff engineer",
    "senior engineer",
    "principal engineer",
    "lead engineer",
    "engineering manager",
    "tech lead",
    "technical lead",
    "software development",
    "sdet",
    "automation engineer",
  ].some((keyword) => normalized.includes(normalizeChoiceText(keyword)));
}

// FIX: Strengthened applied-job detection with site-specific patterns
export function isAppliedJobText(text: string): boolean {
  if (!text) {
    return false;
  }

  const normalized = cleanText(text).toLowerCase();
  if (
    /\b(not applied|apply now|ready to apply|applied (machine|deep|data|ai)|applied scientist|applied research)\b/.test(
      normalized
    )
  ) {
    return false;
  }

  return [
    /^\s*applied\s*$/i,
    /\balready applied\b/,
    /\bpreviously applied\b/,
    /\byou already applied\b/,
    /\byou applied\b/,
    /\byou(?:'ve| have)? applied\b/,
    /\bapplication submitted\b/,
    /\bapplication sent\b/,
    /\balready submitted\b/,
    /\bapplication status:\s*applied\b/,
    /\bjob status:\s*applied\b/,
    /\bjob activity:\s*applied\b/,
    /\bcandidate status:\s*applied\b/,
    /\bapplied on \d/,
    /\bapplied\s+\d+\s+(minute|hour|day|week|month)s?\s+ago\b/,
    /\bstatus:\s*applied\b/,
    /\bapplied\b(?=\s*(?:[|,.:;)\]]|$))/,
    // FIX: ZipRecruiter badge patterns
    /\bapplied\s*✓/i,
    /✓\s*applied\b/i,
    /\bapplication\s+complete\b/i,
    /\byour application was sent\b/i,
    /\bapplication received\b/i,
    // FIX: Dice applied patterns
    /\bapplied\s+to this job\b/i,
    /\bapplied\s+for this\b/i,
  ].some((pattern) => pattern.test(normalized));
}

export function isStrongAppliedJobText(text: string): boolean {
  if (!text) {
    return false;
  }

  const normalized = cleanText(text).toLowerCase();
  if (
    /\b(not applied|apply now|ready to apply|applied scientist|applied research)\b/.test(
      normalized
    )
  ) {
    return false;
  }

  return [
    /^\s*applied\s*$/i,
    /\balready applied\b/,
    /\bpreviously applied\b/,
    /\byou already applied\b/,
    /\byou applied\b/,
    /\byou(?:'ve| have)? applied\b/,
    /\bapplication submitted\b/,
    /\bapplication sent\b/,
    /\balready submitted\b/,
    /\bapplication status:\s*applied\b/,
    /\bjob status:\s*applied\b/,
    /\bjob activity:\s*applied\b/,
    /\bcandidate status:\s*applied\b/,
    /\bapplied on \d/,
    /\bapplied\s+\d+\s+(minute|hour|day|week|month)s?\s+ago\b/,
    /\bstatus:\s*applied\b/,
    /\bapplication\s+complete\b/i,
    /\byour application was sent\b/i,
    /\bapplication received\b/i,
    /\bapplied\s+to this job\b/i,
    /\bapplied\s+for this\b/i,
  ].some((pattern) => pattern.test(normalized));
}

export function isCurrentPageAppliedJob(site: SiteKey | null = null): boolean {
  const currentSurfaceTexts = collectCurrentJobSurfaceTexts(site);

  for (const text of currentSurfaceTexts) {
    if (isStrongAppliedJobText(text)) {
      return true;
    }
  }

  return false;
}

export function shouldFinishJobResultScan(
  observedCount: number,
  targetCount: number,
  stablePasses: number,
  attempt: number,
  site: SiteKey
): boolean {
  const desiredCount = Math.max(1, Math.floor(targetCount));
  if (observedCount >= desiredCount) {
    return true;
  }

  if (observedCount <= 0) {
    return false;
  }

  const needsDeeperWait =
    site === "ziprecruiter" ||
    site === "dice" ||
    site === "startup" ||
    site === "other_sites";
  const minAttemptsBeforeEarlyStop = needsDeeperWait ? 8 : 5;
  const stableThreshold = needsDeeperWait ? 6 : 4;

  return attempt >= minAttemptsBeforeEarlyStop && stablePasses >= stableThreshold;
}

// ─── CANDIDATE COLLECTORS ────────────────────────────────────────────────────

function collectCandidatesFromContainers(
  containerSelectors: string[],
  linkSelectors: string[],
  titleSelectors: string[]
): JobCandidate[] {
  const candidates: JobCandidate[] = [];

  const containers: HTMLElement[] = [];
  for (const selector of containerSelectors) {
    try {
      for (const el of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
        containers.push(el);
      }
    } catch {
      // Skip invalid selectors
    }
  }

  const validLinkSelectors: string[] = [];
  for (const sel of linkSelectors) {
    try {
      document.querySelector(sel);
      validLinkSelectors.push(sel);
    } catch {
      // Skip invalid selector
    }
  }
  const joinedLinkSelectors = validLinkSelectors.join(",");

  const validTitleSelectors: string[] = [];
  for (const sel of titleSelectors) {
    try {
      document.querySelector(sel);
      validTitleSelectors.push(sel);
    } catch {
      // Skip invalid selector
    }
  }
  const joinedTitleSelectors = validTitleSelectors.join(",");

  for (const container of containers) {
    let anchor: HTMLAnchorElement | null = null;
    try {
      if (joinedLinkSelectors) {
        anchor = container.querySelector<HTMLAnchorElement>(joinedLinkSelectors);
      }
    } catch {
      // Skip
    }

    let titleText = "";
    try {
      if (joinedTitleSelectors) {
        titleText =
          cleanText(container.querySelector<HTMLElement>(joinedTitleSelectors)?.textContent) ||
          cleanText(anchor?.textContent) ||
          cleanText(container.getAttribute("data-testid")) ||
          "";
      } else {
        titleText = cleanText(anchor?.textContent) || "";
      }
    } catch {
      titleText = cleanText(anchor?.textContent) || "";
    }

    const contextText = cleanText(container.innerText || container.textContent || "");

    if (!anchor) {
      const dataJk = container.getAttribute("data-jk");
      if (dataJk) {
        addJobCandidate(candidates, `/viewjob?jk=${dataJk}`, titleText, contextText);
      }
      continue;
    }

    if (!titleText || isGenericRoleCtaText(titleText) || isCareerListingCtaText(titleText)) {
      titleText = resolveAnchorCandidateTitle(anchor, contextText);
    }

    if (isCareerListingCtaText(titleText)) {
      continue;
    }

    addJobCandidate(candidates, anchor.href, titleText, contextText);
  }

  return candidates;
}

function collectCandidatesFromAnchors(selectors: string[]): JobCandidate[] {
  const candidates: JobCandidate[] = [];

  for (const selector of selectors) {
    try {
      for (const anchor of Array.from(document.querySelectorAll<HTMLAnchorElement>(selector))) {
        const contextText = cleanText(
          anchor.closest("article, li, section, div")?.textContent || anchor.textContent || ""
        );
        const title = resolveAnchorCandidateTitle(anchor, contextText);
        if (isCareerListingCtaText(title)) {
          continue;
        }
        addJobCandidate(
          candidates,
          anchor.href,
          title,
          contextText
        );
      }
    } catch {
      // Skip invalid selectors
    }
  }

  return candidates;
}

// FIX: New collector for Dice custom web components
function collectDiceSearchCardCandidates(): JobCandidate[] {
  const candidates: JobCandidate[] = [];

  // Dice uses custom elements like dhi-search-card, dhi-job-card, etc.
  const customElements = Array.from(
    document.querySelectorAll<HTMLElement>(
      "dhi-search-card, dhi-job-card, dhi-search-cards-widget .card, [data-testid='search-card'], [class*='search-card'], [class*='SearchCard']"
    )
  );

  for (const card of customElements) {
    // Try shadow DOM first
    const root = card.shadowRoot ?? card;
    const anchor = root.querySelector<HTMLAnchorElement>(
      "a[href*='/job-detail/'], a[href*='/jobs/detail/'], a.card-title-link, a[class*='card-title'], a[class*='job-title'], a[href]"
    );

    if (!anchor?.href) {
      // Check data attributes for job URL
      const dataId = card.getAttribute("data-id") || card.getAttribute("data-job-id");
      if (dataId) {
        const title = cleanText(
          root.querySelector<HTMLElement>(
            "h5, h3, h2, [class*='card-title'], [class*='job-title'], a"
          )?.textContent || ""
        );
        const contextText = cleanText(card.innerText || card.textContent || "");
        if (title) {
          addJobCandidate(
            candidates,
            `https://www.dice.com/job-detail/${dataId}`,
            title,
            contextText
          );
        }
      }
      continue;
    }

    const href = anchor.href;
    if (!href.includes("/job-detail/") && !href.includes("/jobs/detail/")) {
      continue;
    }

    const title = cleanText(
      root.querySelector<HTMLElement>(
        "h5, h3, h2, [class*='card-title'], [class*='job-title']"
      )?.textContent ||
      anchor.textContent ||
      ""
    );
    const contextText = cleanText(card.innerText || card.textContent || "");

    if (!title || title.length < 3) {
      continue;
    }

    addJobCandidate(candidates, href, title, contextText);
  }

  // Also scan shadow roots of all elements on the page for Dice links
  const allShadowHosts = Array.from(
    document.querySelectorAll<HTMLElement>("*")
  ).filter((el) => el.shadowRoot);

  for (const host of allShadowHosts) {
    if (!host.shadowRoot) continue;
    const shadowAnchors = Array.from(
      host.shadowRoot.querySelectorAll<HTMLAnchorElement>(
        "a[href*='/job-detail/'], a[href*='/jobs/detail/']"
      )
    );

    for (const anchor of shadowAnchors) {
      const title = cleanText(anchor.textContent || "");
      const contextText = cleanText(host.innerText || host.textContent || "");
      if (title && title.length >= 3) {
        addJobCandidate(candidates, anchor.href, title, contextText);
      }
    }
  }

  return candidates;
}

// FIX: New collector for ZipRecruiter data-attribute based candidates
function collectZipRecruiterDataAttributeCandidates(): JobCandidate[] {
  const candidates: JobCandidate[] = [];

  // Some ZipRecruiter layouts store job IDs in data attributes
  const elements = Array.from(
    document.querySelectorAll<HTMLElement>(
      "[data-job-id], [data-jid], [data-jobid], [data-job]"
    )
  );

  for (const el of elements) {
    const jobId =
      el.getAttribute("data-job-id") ||
      el.getAttribute("data-jid") ||
      el.getAttribute("data-jobid") ||
      el.getAttribute("data-job") ||
      "";

    if (!jobId || jobId.length < 3) continue;

    // Check if there's already an anchor with a proper URL
    const anchor = el.querySelector<HTMLAnchorElement>("a[href]");
    if (anchor?.href) {
      const title = cleanText(
        el.querySelector<HTMLElement>(
          "h1, h2, h3, [data-testid*='job-title'], [class*='job_title'], [class*='job-title'], [class*='jobTitle']"
        )?.textContent ||
        anchor.textContent ||
        ""
      );
      const contextText = cleanText(el.innerText || el.textContent || "");
      if (title) {
        addJobCandidate(candidates, anchor.href, title, contextText);
      }
      continue;
    }

    // Build URL from job ID
    const title = cleanText(
      el.querySelector<HTMLElement>(
        "h1, h2, h3, [data-testid*='job-title'], [class*='job_title'], [class*='job-title']"
      )?.textContent || ""
    );
    const contextText = cleanText(el.innerText || el.textContent || "");

    if (title) {
      const detailUrl = new URL(window.location.href);
      detailUrl.searchParams.delete("lk");
      detailUrl.searchParams.set("jid", jobId);
      addJobCandidate(candidates, detailUrl.toString(), title, contextText);
    }
  }

  return candidates;
}

function collectMonsterFallbackCandidates(): JobCandidate[] {
  const candidates: JobCandidate[] = [];
  const currentHost = window.location.hostname.toLowerCase();

  if (!currentHost.includes("monster")) {
    return candidates;
  }

  for (const anchor of Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
    const href = anchor.href?.toLowerCase() ?? "";
    const contextText = cleanText(
      anchor.closest("article, li, section, div")?.textContent || anchor.textContent || ""
    );
    const text = resolveAnchorCandidateTitle(anchor, contextText);

    if (!text || text.length < 3 || text.length > 200) {
      continue;
    }

    if (
      [
        "sign in",
        "post a job",
        "career advice",
        "salary",
        "privacy",
        "terms",
        "cookie",
        "help",
        "about",
        "contact",
        "blog",
        "log in",
        "register",
        "create account",
      ].some((skip) => text.toLowerCase().includes(skip))
    ) {
      continue;
    }

    const isJobUrl =
      href.includes("/job-opening") ||
      href.includes("/job/") ||
      href.includes("/job-detail/") ||
      href.includes("job-openings.monster") ||
      href.includes("jobview.monster") ||
      /[?&]jobid=/i.test(href) ||
      /[?&]job_id=/i.test(href) ||
      (href.includes("monster.") &&
        /\/jobs\/[^/?#]{4,}/.test(href) &&
        !href.includes("/jobs/search") &&
        !href.includes("/jobs/browse") &&
        !href.includes("/jobs/q-") &&
        !href.includes("/jobs/l-")) ||
      (href.includes("monster.") && /\/[a-f0-9-]{8,}(?:[?#]|$)/i.test(href));

    if (!isJobUrl) {
      continue;
    }

    addJobCandidate(
      candidates,
      anchor.href,
      text,
      contextText
    );
  }

  return candidates;
}

function collectZipRecruiterCardCandidates(): JobCandidate[] {
  const candidates: JobCandidate[] = [];

  for (const card of Array.from(document.querySelectorAll<HTMLElement>("[id^='job-card-']"))) {
    const rawId = card.id || "";
    const lk = rawId.startsWith("job-card-") ? rawId.slice("job-card-".length) : "";
    if (!lk) {
      continue;
    }

    const titleButton = card.querySelector<HTMLElement>("button[aria-label^='View ']");
    const title =
      cleanText(
        card.querySelector<HTMLElement>(
          "h1, h2, h3, [data-testid*='job-title'], [class*='job_title'], [class*='jobTitle'], [class*='job-title']"
        )?.textContent
      ) ||
      cleanText(titleButton?.getAttribute("aria-label")?.replace(/^View\s+/i, "") || "");
    const contextText = cleanText(card.innerText || card.textContent || "");

    if (!title) {
      continue;
    }

    // FIX: Check if already applied before adding
    if (isAppliedJobText(contextText)) {
      continue;
    }

    const detailUrl = new URL(window.location.href);
    detailUrl.searchParams.delete("jid");
    detailUrl.searchParams.set("lk", lk);

    addJobCandidate(candidates, detailUrl.toString(), title, contextText);
  }

  return candidates;
}

function collectFallbackJobCandidates(): JobCandidate[] {
  const candidates: JobCandidate[] = [];
  const currentHost = window.location.hostname.toLowerCase();

  for (const anchor of Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
    const href = anchor.href?.toLowerCase() ?? "";
    const contextText = cleanText(
      anchor.closest("article, li, section, div")?.textContent || anchor.textContent || ""
    );
    const text = resolveAnchorCandidateTitle(anchor, contextText);

    if (!text || text.length < 4 || text.length > 240) {
      continue;
    }

    if (
      [
        "sign in",
        "sign up",
        "log in",
        "register",
        "privacy",
        "terms",
        "cookie",
        "about us",
        "contact",
        "blog",
        "press",
        "investors",
        "help center",
        "faq",
        "support",
      ].some((skip) => text.toLowerCase().includes(skip))
    ) {
      continue;
    }

    let isSameDomain = false;
    let isKnownAts = false;

    try {
      const linkHost = new URL(anchor.href).hostname.toLowerCase();
      isSameDomain =
        linkHost === currentHost ||
        linkHost.endsWith(`.${currentHost}`) ||
        currentHost.endsWith(`.${linkHost}`);
      isKnownAts = hasKnownAtsHost(linkHost);
    } catch {
      continue;
    }

    if (!isSameDomain && !isKnownAts) {
      continue;
    }

    if (isListingOrCategoryUrl(href) || isCareerListingCtaText(text)) {
      continue;
    }

    const pathSignals = [
      "/jobs/",
      "/job/",
      "/role/",
      "/roles/",
      "/position/",
      "/positions/",
      "/opening/",
      "/openings/",
      "/vacancy/",
      "/vacancies/",
      "/career/",
      "/careers/",
      "/opportunity/",
      "/apply",
    ];

    const hasPathSignal = pathSignals.some((signal) => href.includes(signal));
    const hasTextSignal = looksLikeTechnicalRoleTitle(text);

    if (!hasPathSignal && !hasTextSignal && !isKnownAts) {
      continue;
    }

    addJobCandidate(
      candidates,
      anchor.href,
      text,
      contextText
    );
  }

  return candidates;
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function addJobCandidate(
  candidates: JobCandidate[],
  rawUrl: string,
  rawTitle: string,
  rawContext: string
): void {
  const url = normalizeUrl(rawUrl);
  const title = cleanText(rawTitle);

  if (!url || !title) {
    return;
  }

  candidates.push({
    url,
    title,
    contextText: cleanText(rawContext),
  });
}

function dedupeJobCandidates(candidates: JobCandidate[]): JobCandidate[] {
  const unique = new Map<string, JobCandidate>();

  for (const candidate of candidates) {
    const key = getJobDedupKey(candidate.url);
    if (!key || !candidate.url || !candidate.title) {
      continue;
    }

    const existing = unique.get(key);
    if (!existing || candidate.contextText.length > existing.contextText.length) {
      unique.set(key, candidate);
    }
  }

  return Array.from(unique.values());
}

function collectCurrentJobSurfaceTexts(site: SiteKey | null): string[] {
  const primaryTexts = collectCurrentJobSurfaceTextsForSelectors(
    getPrimaryCurrentJobSurfaceSelectors(site)
  );
  if (primaryTexts.length > 0) {
    return primaryTexts;
  }

  const fallbackTexts = collectCurrentJobSurfaceTextsForSelectors(
    getFallbackCurrentJobSurfaceSelectors()
  );
  if (fallbackTexts.length > 0) {
    return fallbackTexts;
  }

  const bodyText = cleanText(document.body?.innerText || "")
    .toLowerCase()
    .slice(0, 12000);
  if (bodyText) {
    return [bodyText];
  }

  return [];
}

function isReadableSurfaceElement(element: HTMLElement): boolean {
  if (!element.isConnected) {
    return false;
  }

  const styles = window.getComputedStyle(element);
  return (
    styles.visibility !== "hidden" &&
    styles.display !== "none" &&
    styles.opacity !== "0"
  );
}

function getPrimaryCurrentJobSurfaceSelectors(site: SiteKey | null): string[] {
  switch (site) {
    case "ziprecruiter":
      return [
        "[data-testid*='job-details' i]",
        "[data-testid*='jobDetail' i]",
        "[data-testid*='job-description' i]",
        "[class*='jobDetails']",
        "[class*='job-details']",
        "[class*='jobDescription']",
        "[class*='job_description']",
      ];
    case "dice":
      return [
        "[data-testid*='job-details' i]",
        "[data-testid*='jobDetail' i]",
        "[class*='job-details']",
        "[class*='jobDetail']",
        "[class*='job-description']",
        "[class*='jobDescription']",
      ];
    default:
      return [
        "[data-testid*='job-detail' i]",
        "[data-testid*='jobDetail' i]",
        "[data-testid*='job-description' i]",
        "[data-testid*='jobDescription' i]",
        "[class*='job-detail']",
        "[class*='jobDetail']",
        "[class*='job_description']",
        "[class*='jobDescription']",
        "[class*='description']",
      ];
  }
}

function getFallbackCurrentJobSurfaceSelectors(): string[] {
  return [
    "[role='main']",
    "main",
    "article",
  ];
}

function collectCurrentJobSurfaceTextsForSelectors(selectors: string[]): string[] {
  const texts: string[] = [];
  const seen = new Set<string>();

  for (const selector of selectors) {
    let elements: HTMLElement[];
    try {
      elements = Array.from(document.querySelectorAll<HTMLElement>(selector));
    } catch {
      continue;
    }

    for (const element of elements) {
      if (!isReadableSurfaceElement(element)) {
        continue;
      }
      if (element.closest("aside, nav, header, footer")) {
        continue;
      }

      const text = cleanText(element.innerText || element.textContent || "")
        .toLowerCase()
        .slice(0, 12000);
      if (!text || text.length < 40 || seen.has(text)) {
        continue;
      }

      seen.add(text);
      texts.push(text);
    }
  }

  return texts.sort((a, b) => b.length - a.length).slice(0, 4);
}

function isListingOrCategoryUrl(lowerUrl: string): boolean {
  try {
    const parsed = new URL(lowerUrl);
    if (hasJobIdentifyingSearchParam(parsed)) {
      return false;
    }

    const path = parsed.pathname.toLowerCase().replace(/\/+$/, "");
    const segments = path.split("/").filter(Boolean);
    const excludedPaths = [
      "/careers",
      "/career",
      "/jobs",
      "/jobs/search",
      "/openings",
      "/locations",
      "/teams",
      "/departments",
      "/roles",
      "/positions",
      "/opportunities",
      "/about",
      "/benefits",
      "/culture",
      "/values",
      "/diversity",
    ];

    if (excludedPaths.includes(path)) {
      return true;
    }

    if (segments.length === 0) {
      return false;
    }

    if (
      segments.some((segment) => segment === "search" || segment === "browse") ||
      path.includes("/jobs/search") ||
      path.includes("/jobs/browse")
    ) {
      return true;
    }

    if (
      segments[0] === "jobs" &&
      ["remote", "hybrid", "in-office"].includes(segments[1] ?? "")
    ) {
      return true;
    }

    if (
      ["jobs", "career", "careers", "roles", "positions", "openings", "opportunities"].includes(
        segments[0]
      ) &&
      segments.length > 1 &&
      segments.slice(1).every((segment) => isGenericListingSegment(segment))
    ) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

function hasJobIdentifyingSearchParam(parsed: URL): boolean {
  return JOB_DETAIL_QUERY_PARAMS.some((name) => {
    const value = parsed.searchParams.get(name);
    return Boolean(value && value.trim().length > 0);
  });
}

function looksLikeUuidPathSegment(segment: string): boolean {
  return /^[a-f0-9]{8}-[a-f0-9-]{27,}$/i.test(segment);
}

function isKnownAtsListingUrl(parsed: URL): boolean {
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.toLowerCase().replace(/\/+$/, "");
  const segments = path.split("/").filter(Boolean);
  const lastSegment = segments[segments.length - 1] ?? "";
  const isKnownAtsHost = hasKnownAtsHost(host);

  if (!isKnownAtsHost || hasJobIdentifyingSearchParam(parsed)) {
    return false;
  }

  if (
    path.includes("/embed/job_app") ||
    path.includes("/candidate/") ||
    path.includes("/apply/")
  ) {
    return false;
  }

  if (host.includes("lever.co")) {
    return segments.length <= 1;
  }

  if (host.includes("greenhouse.io")) {
    return segments.length <= 1 || (segments.length === 2 && lastSegment === "jobs");
  }

  if (host.includes("ashbyhq.com")) {
    if (looksLikeUuidPathSegment(lastSegment)) {
      return false;
    }

    return segments.length <= 1 || (segments.length === 2 && !path.includes("/job/"));
  }

  if (segments.length <= 1) {
    return true;
  }

  return isGenericListingSegment(lastSegment) && !/\d/.test(lastSegment);
}

function isGenericRoleCtaText(text: string): boolean {
  const normalized = normalizeChoiceText(text);
  if (!normalized) {
    return false;
  }

  return GENERIC_ROLE_CTA_TEXTS.some((label) => normalized === normalizeChoiceText(label));
}

function isCareerListingCtaText(text: string): boolean {
  const normalized = normalizeChoiceText(text);
  if (!normalized) {
    return false;
  }

  return CAREER_LISTING_CTA_TEXTS.some((label) => normalized.includes(normalizeChoiceText(label)));
}

function resolveAnchorCandidateTitle(
  anchor: HTMLAnchorElement,
  contextText: string
): string {
  const directText = cleanText(
    anchor.textContent ||
      anchor.getAttribute("aria-label") ||
      anchor.getAttribute("title") ||
      ""
  );

  if (directText && !isGenericRoleCtaText(directText) && !isCareerListingCtaText(directText)) {
    return directText;
  }

  const container = anchor.closest("article, li, section, div");
  if (container) {
    const heading = container.querySelector<HTMLElement>(
      "h1, h2, h3, h4, h5, [data-testid*='title'], [class*='title'], [class*='job-title'], [class*='role-title']"
    );
    const headingText = cleanText(heading?.textContent || "");
    if (headingText && !isCareerListingCtaText(headingText)) {
      return headingText;
    }
  }

  for (const line of extractContextLines(contextText)) {
    if (isCareerListingCtaText(line) || isGenericRoleCtaText(line)) {
      continue;
    }
    if (looksLikeTechnicalRoleTitle(line)) {
      return line;
    }
  }

  return directText;
}

function extractContextLines(text: string): string[] {
  return text
    .split(/\r?\n+/)
    .map((line) => cleanText(line))
    .filter((line) => line.length >= 4 && line.length <= 180);
}

function stringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isGenericListingSegment(segment: string): boolean {
  return new Set([
    "all",
    "browse",
    "career",
    "careers",
    "department",
    "departments",
    "design",
    "dev-engineering",
    "engineering",
    "europe",
    "eu",
    "finance",
    "front-end",
    "frontend",
    "full-stack",
    "fullstack",
    "hybrid",
    "in-office",
    "job",
    "job-board",
    "jobs",
    "location",
    "locations",
    "marketing",
    "open-jobs",
    "open-positions",
    "open-roles",
    "opening",
    "openings",
    "opportunities",
    "opportunity",
    "people",
    "position",
    "positions",
    "product",
    "remote",
    "role",
    "roles",
    "sales",
    "search",
    "support",
    "team",
    "teams",
    "uk",
    "united-kingdom",
    "united-states",
    "us",
    "usa",
    "vacancies",
  ]).has(segment);
}

// ─── DATE / RECENCY HELPERS ─────────────────────────────────────────────────

function filterCandidatesByDatePostedWindow(
  candidates: JobCandidate[],
  datePostedWindow: DatePostedWindow
): JobCandidate[] {
  const maxAgeHours = getMaxPostedAgeHours(datePostedWindow);
  if (maxAgeHours === null) {
    return candidates;
  }

  return candidates.filter((candidate) => {
    const ageHours = extractPostedAgeHours(candidate.contextText);
    return ageHours !== null && ageHours <= maxAgeHours;
  });
}

function sortCandidatesByRecency(
  candidates: JobCandidate[],
  datePostedWindow: DatePostedWindow
): JobCandidate[] {
  if (datePostedWindow === "any") {
    return candidates;
  }

  return [...candidates].sort((a, b) =>
    comparePostedAgeHours(
      extractPostedAgeHours(a.contextText),
      extractPostedAgeHours(b.contextText),
      datePostedWindow
    )
  );
}

function comparePostedAgeHours(
  left: number | null,
  right: number | null,
  datePostedWindow: DatePostedWindow
): number {
  if (datePostedWindow === "any") {
    return 0;
  }

  if (left === null && right === null) {
    return 0;
  }
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }
  return left - right;
}

function getMaxPostedAgeHours(datePostedWindow: DatePostedWindow): number | null {
  switch (datePostedWindow) {
    case "24h":
      return 24;
    case "3d":
      return 24 * 3;
    case "1w":
      return 24 * 7;
    case "any":
      return null;
  }
}

function extractPostedAgeHours(text: string): number | null {
  const normalized = normalizeChoiceText(text).replace(/\s+/g, " ");
  if (!normalized) {
    return null;
  }

  if (/\bjust posted\b/.test(normalized)) {
    return 0;
  }

  if (
    /\b(?:posted|active|updated|listed)\s+today\b/.test(normalized) ||
    /\bnew today\b/.test(normalized)
  ) {
    return 12;
  }

  if (/\b(?:posted|active|updated|listed)\s+yesterday\b/.test(normalized)) {
    return 24;
  }

  const explicitAgoMatch = normalized.match(
    /\b(?:(?:posted|active|updated|listed)\s+)?(\d+)\+?\s*(hours?|hrs?|hr|h|days?|d|weeks?|w|months?|mos?|mo)\s+ago\b/
  );
  if (explicitAgoMatch) {
    return convertAgeValueToHours(explicitAgoMatch[1], explicitAgoMatch[2]);
  }

  const postedWithinMatch = normalized.match(
    /\b(?:posted|active|updated|listed)\s+(\d+)\+?\s*(hours?|hrs?|hr|h|days?|d|weeks?|w|months?|mos?|mo)\b/
  );
  if (postedWithinMatch) {
    return convertAgeValueToHours(postedWithinMatch[1], postedWithinMatch[2]);
  }

  if (/\btoday\b/.test(normalized)) {
    return 12;
  }

  if (/\byesterday\b/.test(normalized)) {
    return 24;
  }

  return null;
}

function convertAgeValueToHours(rawValue: string, rawUnit: string): number | null {
  const value = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(value) || value < 0) {
    return null;
  }

  const unit = rawUnit.toLowerCase();
  if (unit === "h" || unit === "hr" || unit === "hrs" || unit === "hour" || unit === "hours") {
    return value;
  }
  if (unit === "d" || unit === "day" || unit === "days") {
    return value * 24;
  }
  if (unit === "w" || unit === "week" || unit === "weeks") {
    return value * 24 * 7;
  }
  if (unit === "mo" || unit === "mos" || unit === "month" || unit === "months") {
    return value * 24 * 30;
  }
  return null;
}

// ─── RESUME-KIND SCORING ────────────────────────────────────────────────────

function scoreJobTitleForResume(title: string, resumeKind: ResumeKind): number {
  const normalizedTitle = title.toLowerCase();

  switch (resumeKind) {
    case "front_end": {
      let score = 0;
      if (
        /\b(front\s*end|frontend|ui engineer|ui developer|react|angular|vue)\b/.test(
          normalizedTitle
        )
      ) {
        score += 4;
      }
      if (/\b(full\s*stack|fullstack)\b/.test(normalizedTitle)) {
        score += 1;
      }
      if (/\b(back\s*end|backend|server)\b/.test(normalizedTitle)) {
        score -= 3;
      }
      return score;
    }

    case "back_end": {
      let score = 0;
      if (
        /\b(back\s*end|backend|server|api|platform engineer)\b/.test(normalizedTitle)
      ) {
        score += 4;
      }
      if (/\b(full\s*stack|fullstack)\b/.test(normalizedTitle)) {
        score += 1;
      }
      if (/\b(front\s*end|frontend|ui)\b/.test(normalizedTitle)) {
        score -= 3;
      }
      return score;
    }

    case "full_stack":
      if (/\b(full\s*stack|fullstack)\b/.test(normalizedTitle)) {
        return 5;
      }
      if (/\b(front\s*end|frontend|back\s*end|backend)\b/.test(normalizedTitle)) {
        return 1;
      }
      return 0;
  }
}
