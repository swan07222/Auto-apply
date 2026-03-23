// src/content/jobSearch.ts
// COMPLETE FILE — replace entirely

import { DatePostedWindow, ResumeKind, SiteKey, getJobDedupKey } from "../shared";
import { JobCandidate } from "./types";
import { cleanText, normalizeChoiceText } from "./text";
import { normalizeUrl } from "./dom";
import {
  CAREER_LISTING_TEXT_PATTERNS,
  hasJobDetailAtsUrl,
  hasKnownAtsHost,
} from "./sitePatterns";
import {
  getCareerSiteJobLinkSelectors,
  getDiceListCardSelectors,
  getDiceNestedResultSelectors,
  getDiceSearchCardSelectors,
  getPrimaryCurrentJobSurfaceSelectors,
} from "./sites";

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
  "easy apply",
  "apply here",
  "apply on employer site",
  "apply on company site",
  "learn more",
  "read more",
  "details",
  "job details",
  "more details",
  "view job",
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

function isElementLike(value: unknown): value is Element {
  return Boolean(
    value &&
      typeof value === "object" &&
      "closest" in value &&
      "getAttribute" in value
  );
}

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

    case "ziprecruiter": {
      return filterZipRecruiterAppliedCandidates(
        dedupeJobCandidates([
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
          ...collectZipRecruiterDataAttributeCandidates(),
        ])
      );
    }

    case "dice":
      return filterDiceViewedOrAppliedCandidates(
        dedupeJobCandidates([
          ...collectDiceListItemCandidates(),
          // Prefer Dice-specific collectors over the generic fallbacks.
          // Live Dice cards expose multiple anchors per card (overlay, apply, title),
          // and the broad fallback collectors can re-ingest the same job with noisy
          // context from outside the card.
          ...collectDiceSearchCardCandidates(),
        ])
      );

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

    case "glassdoor":
      return dedupeJobCandidates([
        ...collectCandidatesFromContainers(
          [
            "[data-test='jobListing']",
            "[data-test*='job-listing' i]",
            "[data-test*='job-card' i]",
            "[data-test*='job-link-row' i]",
            "[class*='job-card']",
            "[class*='JobCard']",
            "[class*='jobCard']",
            "[class*='job-listing']",
            "[class*='JobListItem']",
            "[class*='jobListItem']",
            "[class*='JobsList_jobListItem']",
            "article",
            "li",
          ],
          [
            "a[href*='/job-listing/' i]",
            "a[href*='/partner/joblisting.htm' i]",
            "a[href*='jl=' i]",
            "a[href*='joblistingid=' i]",
            "a[data-test='job-link']",
            "a[data-test*='job-link' i]",
            "a[data-test*='job-title' i]",
          ],
          [
            "h1",
            "h2",
            "h3",
            "[data-test='job-link']",
            "[data-test*='job-title' i]",
            "[class*='jobTitle']",
            "[class*='JobTitle']",
            "[class*='title']",
          ]
        ),
        ...collectCandidatesFromAnchors([
          "a[href*='/job-listing/' i]",
          "a[href*='/partner/joblisting.htm' i]",
          "a[href*='jl=' i]",
          "a[href*='joblistingid=' i]",
          "a[data-test='job-link']",
          "a[data-test*='job-link' i]",
          "a[data-test*='job-title' i]",
        ]),
      ]);

    case "startup":
    case "other_sites":
      return dedupeJobCandidates([
        ...collectFocusedAtsLinkCandidates(),
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
          getCareerSiteJobLinkSelectors("other_sites"),
          ["h1", "h2", "h3", "h4", "[data-testid*='title']", "[class*='title']"]
        ),
        ...collectCandidatesFromAnchors(getCareerSiteJobLinkSelectors("other_sites")),
        ...collectFallbackJobCandidates(),
      ]);

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
      stringOrEmpty(record.canonicalUrl) ||
      stringOrEmpty((jobResult as { url?: unknown }).url);
    const title =
      stringOrEmpty(record.normalizedJobPosting?.title) ||
      stringOrEmpty(record.jobPosting?.title) ||
      stringOrEmpty((jobResult as { title?: unknown }).title);
    const appliedSignal = extractMonsterEmbeddedAppliedSignal(
      jobResult as Record<string, unknown>
    );
    const contextText = cleanText(
      [
        stringOrEmpty(record.normalizedJobPosting?.hiringOrganization?.name) ||
          stringOrEmpty(record.jobPosting?.hiringOrganization?.name),
        stringOrEmpty(record.location?.displayText) ||
          stringOrEmpty(record.location?.displayTextJobCard),
        stringOrEmpty(record.dateRecency),
        stringOrEmpty(record.enrichments?.processedDescriptions?.shortDescription),
        stringOrEmpty(
          (jobResult as { hiringOrganization?: { name?: unknown } }).hiringOrganization?.name
        ),
        stringOrEmpty((jobResult as { datePosted?: unknown }).datePosted),
        stringOrEmpty((jobResult as { description?: unknown }).description),
        appliedSignal ? "already applied" : "",
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
  datePostedWindow: DatePostedWindow = "any",
  searchKeywords: string[] = []
): string[] {
  const valid = dedupeJobCandidates(candidates).filter((candidate) =>
    isLikelyJobDetailUrl(site, candidate.url, candidate.title, candidate.contextText)
  );

  const recencyFiltered = filterCandidatesByDatePostedWindow(valid, datePostedWindow);
  const recencyEligible = datePostedWindow === "any" ? valid : recencyFiltered;
  const eligible =
    site === "dice"
      ? recencyEligible.filter((candidate) => isExplicitlyRemoteDiceCandidate(candidate))
      : filterCandidatesForRemotePreference(recencyEligible);
  const shouldKeywordFilter =
    searchKeywords.length > 0 &&
    (site === "startup" || site === "other_sites");
  const boardKeywordMatchedCandidates =
    searchKeywords.length > 0 &&
    (site === "indeed" ||
      site === "ziprecruiter" ||
      site === "dice" ||
      site === "monster" ||
      site === "glassdoor")
      ? eligible.filter((candidate) =>
          scoreCandidateKeywordRelevance(candidate, searchKeywords) > 0
        )
      : [];
  const shouldKeywordFilterBoardResults =
    shouldFilterBoardResultsByKeyword(
      site,
      eligible.length,
      boardKeywordMatchedCandidates.length
    );
  const keywordEligible =
    shouldKeywordFilter
      ? eligible.filter((candidate) =>
          matchesConfiguredSearchKeywords(candidate, searchKeywords)
        )
      : shouldKeywordFilterBoardResults
        ? boardKeywordMatchedCandidates
      : eligible;
  const technicalEligible =
    site === "startup" || site === "other_sites"
      ? keywordEligible.filter((candidate) =>
          looksLikeTechnicalRoleTitle(candidate.title)
        )
      : keywordEligible;

  if (shouldKeywordFilter && keywordEligible.length === 0) {
    return [];
  }

  if (!resumeKind) {
    const fallbackPool =
      technicalEligible.length > 0 ? technicalEligible : keywordEligible;
    return sortCandidatesByRecency(fallbackPool, datePostedWindow).map((candidate) => candidate.url);
  }

  const fallbackPool =
    site === "startup" || site === "other_sites"
      ? technicalEligible
      : keywordEligible;

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

function shouldFilterBoardResultsByKeyword(
  site: SiteKey | null,
  eligibleCount: number,
  matchedCount: number
): boolean {
  if (matchedCount <= 0 || eligibleCount <= 0) {
    return false;
  }

  if (site === "ziprecruiter") {
    return (
      matchedCount >= Math.max(2, eligibleCount - 1) &&
      matchedCount >= 2
    );
  }

  return matchedCount >= Math.min(3, Math.max(1, Math.ceil(eligibleCount / 2)));
}

function matchesConfiguredSearchKeywords(
  candidate: JobCandidate,
  searchKeywords: string[]
): boolean {
  return scoreCandidateKeywordRelevance(candidate, searchKeywords) > 0;
}

function scoreCandidateKeywordRelevance(
  candidate: JobCandidate,
  searchKeywords: string[]
): number {
  const haystack = normalizeChoiceText(
    `${candidate.title} ${candidate.contextText}`
  );

  let bestScore = 0;
  for (const keyword of searchKeywords) {
    const normalizedKeyword = normalizeChoiceText(keyword);
    if (!normalizedKeyword) {
      continue;
    }

    if (haystack.includes(normalizedKeyword)) {
      bestScore = Math.max(bestScore, 100);
      continue;
    }

    const keywordTokens = normalizedKeyword
      .split(/\s+/)
      .filter((token) => token.length >= 2);
    if (keywordTokens.length === 0) {
      continue;
    }

    const haystackTokens = new Set(haystack.split(/\s+/).filter(Boolean));
    const matchedTokens = keywordTokens.filter((token) =>
      haystackTokens.has(token)
    ).length;
    const score = Math.round((matchedTokens / keywordTokens.length) * 100);
    bestScore = Math.max(bestScore, score);
  }

  return bestScore >= 75 ? bestScore : 0;
}

function filterCandidatesForRemotePreference(
  candidates: JobCandidate[]
): JobCandidate[] {
  const annotated = candidates.map((candidate) => ({
    candidate,
    remoteScore: scoreRemotePreference(candidate),
  }));
  const hasLocationModeSignal = annotated.some(
    (entry) => entry.remoteScore !== 0
  );

  if (!hasLocationModeSignal) {
    return candidates;
  }

  return annotated
    .filter((entry) => entry.remoteScore > 0)
    .map((entry) => entry.candidate);
}

function scoreRemotePreference(candidate: JobCandidate): number {
  const haystack = normalizeChoiceText(
    `${candidate.title} ${candidate.contextText} ${candidate.url}`
  );

  let score = 0;

  if (
    /\b(remote|fully remote|100 remote|work from home|distributed|anywhere|remote first|home based|home-based|remote us|remote usa)\b/.test(
      haystack
    )
  ) {
    score += 2;
  }

  if (/\b(hybrid|remote hybrid|hybrid remote)\b/.test(haystack)) {
    score -= 2;
  }

  if (
    /\b(onsite|on site|in office|in-office|office based|office-based|relocation required|local only|must be onsite)\b/.test(
      haystack
    )
  ) {
    score -= 3;
  }

  return score;
}

function isExplicitlyRemoteDiceCandidate(candidate: JobCandidate): boolean {
  const haystack = normalizeChoiceText(
    `${candidate.title} ${candidate.contextText} ${candidate.url}`
  );

  if (
    /\b(hybrid|hybrid only|hybrid remote|remote hybrid|onsite|on site|in office|in-office|office based|office-based|local only|must be onsite)\b/.test(
      haystack
    )
  ) {
    return false;
  }

  return /\b(remote|fully remote|100 remote|work from home|distributed|anywhere|remote first|home based|home-based|remote us|remote usa)\b/.test(
    haystack
  );
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
      try {
        const parsedIndeedUrl = new URL(url, window.location.href);
        const jobKey =
          parsedIndeedUrl.searchParams.get("jk") ??
          parsedIndeedUrl.searchParams.get("vjk");
        const hasTrackedIndeedJobPath =
          lowerUrl.includes("/viewjob") ||
          lowerUrl.includes("/rc/clk") ||
          lowerUrl.includes("/pagead/clk");

        return hasTrackedIndeedJobPath && Boolean(jobKey);
      } catch {
        return false;
      }

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

    case "glassdoor": {
      if (/[?&](?:jl|joblistingid)=/i.test(lowerUrl)) {
        return true;
      }

      if (
        lowerUrl.includes("/job-listing/") ||
        lowerUrl.includes("/partner/joblisting.htm")
      ) {
        return true;
      }

      if (
        lowerUrl.includes("/job/jobs.htm") ||
        /\/job\/?$/i.test(lowerUrl) ||
        lowerUrl.includes("/salaries/") ||
        lowerUrl.includes("/reviews/") ||
        lowerUrl.includes("/benefits/") ||
        lowerUrl.includes("/interviews/") ||
        lowerUrl.includes("/community/") ||
        lowerUrl.includes("/employers/") ||
        lowerUrl.includes("/companies/")
      ) {
        return false;
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

  }
}

export function looksLikeTechnicalRoleTitle(text: string): boolean {
  const normalized = normalizeChoiceText(text);

  if (!normalized) {
    return false;
  }

  const strongSignals = [
    "software engineer",
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
  ];

  const broadSignals = [
    "engineer",
    "developer",
    "architect",
  ];

  const negativeSignals = [
    "sales",
    "marketing",
    "recruiter",
    "talent acquisition",
    "people operations",
    "human resources",
    "finance",
    "account executive",
    "customer success",
    "support specialist",
    "operations manager",
    "office manager",
    "attorney",
    "legal counsel",
    "copywriter",
    "content strategist",
    "business development",
  ];

  const hasStrongSignal = strongSignals.some((keyword) =>
    normalized.includes(normalizeChoiceText(keyword))
  );
  const hasBroadSignal = broadSignals.some((keyword) =>
    normalized.includes(normalizeChoiceText(keyword))
  );
  const hasNegativeSignal = negativeSignals.some((keyword) =>
    normalized.includes(normalizeChoiceText(keyword))
  );

  if (!hasStrongSignal && !hasBroadSignal) {
    return false;
  }

  if (hasNegativeSignal && !hasStrongSignal) {
    return false;
  }

  return true;
}

// FIX: Strengthened applied-job detection with site-specific patterns
export function isAppliedJobText(text: string): boolean {
  if (!text) {
    return false;
  }

  const normalized = cleanText(text).toLowerCase();
  
  // FIX: Explicitly exclude "Applied" role titles to prevent false positives
  // These are job titles, not application status indicators
  const appliedRolePatterns = [
    /\bapplied\s+scientist\b/,
    /\bapplied\s+research\b/,
    /\bapplied\s+machine\s+learning\b/,
    /\bapplied\s+deep\s+learning\b/,
    /\bapplied\s+data\s+scientist\b/,
    /\bapplied\s+ai\b/,
    /\bapplied\s+ml\b/,
    /\bapplied\s+researcher\b/,
    /\bapplied\s+engineer\b/,
  ];
  
  if (appliedRolePatterns.some(pattern => pattern.test(normalized))) {
    return false;
  }
  
  // Exclude other non-applied-status patterns
  if (
    /\b(not applied|apply now|ready to apply)\b/.test(normalized)
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
    /\bapplied\s*[\u2713\u2714\u2611](?:\s|$)/i,
    /(?:^|\s)[\u2713\u2714\u2611]\s*applied\b/i,
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
    /\bapplied\s*[\u2713\u2714\u2611](?:\s|$)/i,
    /(?:^|\s)[\u2713\u2714\u2611]\s*applied\b/i,
    /\bapplication\s+complete\b/i,
    /\byour application was sent\b/i,
    /\bapplication received\b/i,
    /\bapplied\s+to this job\b/i,
    /\bapplied\s+for this\b/i,
  ].some((pattern) => pattern.test(normalized));
}

export function isCurrentPageAppliedJob(site: SiteKey | null = null): boolean {
  if (site === "indeed") {
    if (isIndeedApplyConfirmationPage()) {
      return true;
    }
    if (isActiveIndeedApplyStep()) {
      return false;
    }
  }

  const currentSurfaceTexts = collectCurrentJobSurfaceTexts(site);

  for (const text of currentSurfaceTexts) {
    if (isStrongAppliedJobText(text)) {
      if (site === "dice" && hasVisibleDiceApplySignal()) {
        return false;
      }
      return true;
    }
  }

  if (site === "ziprecruiter" && hasVisibleZipRecruiterAppliedSignal()) {
    return true;
  }

  return false;
}

function getIndeedApplyPageText(): string {
  return cleanText(
    document.body?.innerText || document.body?.textContent || ""
  )
    .toLowerCase()
    .slice(0, 12000);
}

function isIndeedApplyConfirmationPage(): boolean {
  const lowerUrl = window.location.href.toLowerCase();
  const lowerPath = window.location.pathname.toLowerCase();
  if (
    !(
      lowerUrl.includes("smartapply.indeed.com") ||
      lowerPath.includes("/indeedapply/form/")
    )
  ) {
    return false;
  }

  return /\b(your application has been submitted|thanks for applying|application submitted|application complete|application received)\b/.test(
    getIndeedApplyPageText()
  );
}

function isActiveIndeedApplyStep(): boolean {
  const lowerUrl = window.location.href.toLowerCase();
  const lowerPath = window.location.pathname.toLowerCase();
  if (
    !(
      lowerUrl.includes("smartapply.indeed.com") ||
      lowerPath.includes("/indeedapply/form/")
    )
  ) {
    return false;
  }

  const bodyText = getIndeedApplyPageText();

  if (isIndeedApplyConfirmationPage()) {
    return false;
  }

  if (
    /\/(?:review-module|resume-selection-module|demographic-questions-module|contact-info-module|work-experience-module|education-module|cover-letter-module|additional-documents-module)(?:[/?#]|$)/.test(
      lowerPath
    )
  ) {
    return true;
  }

  if (
    /\b(please review your application|review your application|add a resume for the employer|save and close|step\s+\d+\s+of\s+\d+)\b/.test(
      bodyText
    )
  ) {
    return true;
  }

  for (const control of Array.from(
    document.querySelectorAll<HTMLElement>(
      "button, a[role='button'], [role='button'], input[type='submit'], input[type='button']"
    )
  )) {
    const controlText = cleanText(
      control.innerText ||
        control.textContent ||
        control.getAttribute("aria-label") ||
        control.getAttribute("value") ||
        ""
    ).toLowerCase();
    if (!controlText) {
      continue;
    }
    if (
      [
        "submit",
        "submit application",
        "continue",
        "back",
        "save and close",
        "edit",
      ].some(
        (signal) =>
          controlText === signal || controlText.includes(` ${signal}`) || controlText.startsWith(`${signal} `)
      )
    ) {
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

  // Give slower boards enough time to reach their later "open jobs list" or
  // "load more" recovery passes before we conclude the surface is exhausted.
  let minAttemptsBeforeEarlyStop = 5;
  let stableThreshold = 4;

  if (site === "startup" || site === "other_sites") {
    minAttemptsBeforeEarlyStop = 22;
    stableThreshold = 8;
  } else if (site === "monster") {
    minAttemptsBeforeEarlyStop = 18;
    stableThreshold = 8;
  } else if (
    site === "indeed" ||
    site === "ziprecruiter" ||
    site === "dice" ||
    site === "glassdoor"
  ) {
    if (site === "dice") {
      minAttemptsBeforeEarlyStop = 18;
      stableThreshold = 10;
    } else {
      minAttemptsBeforeEarlyStop = site === "indeed" ? 16 : 18;
      stableThreshold = site === "indeed" ? 8 : 10;
    }
  }

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

    const contextText = buildCandidateContextText(container, anchor);
    const canonicalIndeedUrl =
      getCanonicalIndeedCandidateUrl(container) ??
      getCanonicalIndeedCandidateUrl(anchor);

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

    addJobCandidate(
      candidates,
      canonicalIndeedUrl ?? anchor.href,
      titleText,
      contextText
    );
  }

  return candidates;
}

function collectCandidatesFromAnchors(selectors: string[]): JobCandidate[] {
  const candidates: JobCandidate[] = [];

  for (const selector of selectors) {
    try {
      for (const anchor of Array.from(document.querySelectorAll<HTMLAnchorElement>(selector))) {
        const contextText = buildCandidateContextText(
          anchor.closest<HTMLElement>("article, li, section, div"),
          anchor
        );
        const title = resolveAnchorCandidateTitle(anchor, contextText);
        if (isCareerListingCtaText(title)) {
          continue;
        }
        const canonicalIndeedUrl = getCanonicalIndeedCandidateUrl(anchor);
        addJobCandidate(
          candidates,
          canonicalIndeedUrl ?? anchor.href,
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

function collectFocusedAtsLinkCandidates(): JobCandidate[] {
  const candidates: JobCandidate[] = [];

  for (const selector of getCareerSiteJobLinkSelectors("other_sites")) {
    try {
      for (const anchor of Array.from(document.querySelectorAll<HTMLAnchorElement>(selector))) {
        if (!hasJobDetailAtsUrl(anchor.href)) {
          continue;
        }

        const title = cleanText(
          anchor.textContent ||
            anchor.getAttribute("aria-label") ||
            anchor.getAttribute("title") ||
            ""
        );
        if (!title || isGenericRoleCtaText(title) || isCareerListingCtaText(title)) {
          continue;
        }

        addJobCandidate(candidates, anchor.href, title, title);
      }
    } catch {
      // Skip invalid selectors
    }
  }

  return candidates;
}

function collectDiceListItemCandidates(): JobCandidate[] {
  const candidates: JobCandidate[] = [];
  const cards = Array.from(
    document.querySelectorAll<HTMLElement>(
      getDiceListCardSelectors().join(", ")
    )
  );

  for (const card of cards) {
    const titleAnchor =
      card.querySelector<HTMLAnchorElement>(
        "a[data-testid='job-search-job-detail-link']"
      ) ??
      card.querySelector<HTMLAnchorElement>(
        "a[href*='/job-detail/'], a[href*='/jobs/detail/']"
      ) ??
      null;
    const primaryUrlAnchor =
      card.querySelector<HTMLAnchorElement>(
        "a[data-testid='job-search-job-card-link']"
      ) ?? titleAnchor;
    if (!titleAnchor?.href || !primaryUrlAnchor?.href) {
      continue;
    }

    const title = cleanText(
      titleAnchor.textContent ||
        titleAnchor.getAttribute("aria-label") ||
        card.querySelector<HTMLElement>(
          "h1, h2, h3, h4, h5, [data-testid='job-search-job-detail-link']"
        )?.textContent ||
        ""
    );
    if (!title) {
      continue;
    }

    if (shouldSkipDiceTitleCandidate(titleAnchor, card)) {
      continue;
    }

    addJobCandidate(
      candidates,
      primaryUrlAnchor.href,
      title,
      buildDiceCandidateContextText(card, titleAnchor)
    );
  }

  return candidates;
}

// FIX: New collector for Dice custom web components
function collectDiceSearchCardCandidates(): JobCandidate[] {
  const candidates: JobCandidate[] = [];

  // Dice uses custom elements like dhi-search-card, dhi-job-card, etc.
  const customElements = Array.from(
    document.querySelectorAll<HTMLElement>(
      getDiceSearchCardSelectors().join(", ")
    )
  );

  for (const card of customElements) {
    // Try shadow DOM first
    const root = card.shadowRoot ?? card;
    const titleAnchor =
      root.querySelector<HTMLAnchorElement>(
        "a[data-testid='job-search-job-detail-link']"
      ) ??
      root.querySelector<HTMLAnchorElement>(
        "a[href*='/job-detail/'], a[href*='/jobs/detail/'], a.card-title-link, a[class*='card-title'], a[class*='job-title']"
      ) ??
      null;
    const primaryUrlAnchor =
      root.querySelector<HTMLAnchorElement>(
        "a[data-testid='job-search-job-card-link']"
      ) ?? titleAnchor;

    if (!titleAnchor?.href) {
      // Check data attributes for job URL
      const dataId = card.getAttribute("data-id") || card.getAttribute("data-job-id");
      if (dataId) {
        const titleElement =
          root.querySelector<HTMLElement>(
            "h5, h3, h2, [class*='card-title'], [class*='job-title'], a"
          ) ?? null;
        const title = cleanText(
          titleElement?.textContent || ""
        );
        const contextText = buildDiceCandidateContextText(card, titleElement);
        if (title) {
          if (shouldSkipDiceTitleCandidate(titleElement ?? card, card)) {
            continue;
          }
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

    const href = primaryUrlAnchor?.href ?? titleAnchor.href;
    if (!href.includes("/job-detail/") && !href.includes("/jobs/detail/")) {
      continue;
    }

    const title = cleanText(
      root.querySelector<HTMLElement>(
        "h5, h3, h2, [class*='card-title'], [class*='job-title']"
      )?.textContent ||
      titleAnchor.textContent ||
      ""
    );
    const contextText = buildDiceCandidateContextText(card, titleAnchor);

    if (!title || title.length < 3) {
      continue;
    }

    if (shouldSkipDiceTitleCandidate(titleAnchor, card)) {
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
      const contextText = buildDiceCandidateContextText(host, anchor);
      if (shouldSkipDiceTitleCandidate(anchor, host)) {
        continue;
      }
      if (title && title.length >= 3) {
        addJobCandidate(candidates, anchor.href, title, contextText);
      }
    }
  }

  return candidates;
}

function shouldSkipDiceTitleCandidate(
  titleAnchor: HTMLElement | null,
  container: HTMLElement
): boolean {
  const metadata = buildDiceCandidateMetadata(titleAnchor, container);

  if (/\b(applied|viewed|visited|seen|read)\b/.test(metadata)) {
    return true;
  }

  const colorSource = titleAnchor ?? container;
  if (!shouldEvaluateDiceTitleColor(colorSource, container)) {
    return false;
  }

  const color = window.getComputedStyle(colorSource).color;
  if (!color) {
    return false;
  }

  const match = color.match(
    /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/
  );
  if (!match) {
    return false;
  }

  const channels = match.slice(1, 4).map((value) => Number(value));
  return isDiceVisitedLikeColor(channels);
}

function shouldEvaluateDiceTitleColor(
  titleElement: HTMLElement,
  container: HTMLElement
): boolean {
  if (titleElement !== container) {
    return true;
  }

  const inlineColorSignal = [
    titleElement.getAttribute("style"),
    container.getAttribute("style"),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (inlineColorSignal.includes("color")) {
    return true;
  }

  const classSignal = [
    typeof titleElement.className === "string" ? titleElement.className : "",
    typeof container.className === "string" ? container.className : "",
  ]
    .join(" ")
    .toLowerCase();

  return /\b(text-|visited:|visited\b|applied\b|viewed\b|seen\b|read\b)/.test(
    classSignal
  );
}

function isDiceVisitedLikeColor(channels: number[]): boolean {
  const [red, green, blue] = channels;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);

  return blue >= 120 && red >= 70 && blue > green && max - min >= 60;
}

function buildDiceCandidateMetadata(
  titleAnchor: HTMLElement | null,
  container: HTMLElement
): string {
  const fragments = new Set<string>();
  const addElementMetadata = (element: HTMLElement | null | undefined) => {
    if (!element) {
      return;
    }

    const metadata = cleanText(
      [
        element.innerText || element.textContent || "",
        extractDiceSemanticStatusTokens(
          typeof element.className === "string" ? element.className : ""
        ),
        element.id,
        element.getAttribute("data-testid"),
        element.getAttribute("data-cy"),
        element.getAttribute("data-status"),
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
      ]
        .filter(Boolean)
        .join(" ")
    );

    if (metadata) {
      fragments.add(metadata);
    }
  };

  addElementMetadata(titleAnchor);
  addElementMetadata(container);

  const statusSelectors = [
    "[data-status]",
    "[data-testid]",
    "[data-cy]",
    "[aria-label]",
    "[title]",
    "[class*='applied']",
    "[class*='viewed']",
    "[class*='visited']",
    "[class*='seen']",
    "[class*='read']",
    "[id*='applied']",
    "[id*='viewed']",
    "[id*='visited']",
    "[id*='seen']",
    "[id*='read']",
  ];

  for (const element of Array.from(
    container.querySelectorAll<HTMLElement>(statusSelectors.join(", "))
  ).slice(0, 32)) {
    addElementMetadata(element);
  }

  return cleanText(Array.from(fragments).join(" ")).toLowerCase();
}

function extractDiceSemanticStatusTokens(className: string): string {
  if (!className) {
    return "";
  }

  const styleUtilityPrefixes =
    /^(?:text|bg|border|outline|decoration|fill|stroke|ring|shadow|from|via|to)-/;

  return className
    .split(/\s+/)
    .map((token) => cleanText(token).toLowerCase())
    .filter((token) => {
      if (!token || token.includes(":")) {
        return false;
      }

      if (!/(applied|viewed|visited|seen|read)/.test(token)) {
        return false;
      }

      if (styleUtilityPrefixes.test(token)) {
        return false;
      }

      return /(?:^|[-_])(applied|viewed|visited|seen|read)(?:$|[-_])/.test(token);
    })
    .join(" ");
}

function filterDiceViewedOrAppliedCandidates(
  candidates: JobCandidate[]
): JobCandidate[] {
  return candidates.filter((candidate) => {
    const candidateKey = getJobDedupKey(candidate.url);
    const normalizedTitle = normalizeChoiceText(candidate.title);

    for (const anchor of Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
      const anchorKey = getJobDedupKey(anchor.href);
      const titleMatch =
        normalizedTitle &&
        normalizeChoiceText(anchor.textContent || "") === normalizedTitle;

      if (candidateKey ? anchorKey !== candidateKey : !titleMatch) {
        continue;
      }

      const container =
        anchor.closest<HTMLElement>("li, article, section, div, dhi-search-card, dhi-job-card") ??
        anchor;
      if (shouldSkipDiceTitleCandidate(anchor, container)) {
        return false;
      }
    }

    return true;
  });
}

function collectZipRecruiterAppliedDedupKeys(): Set<string> {
  const keys = new Set<string>();
  const addKey = (rawUrl: string | null | undefined) => {
    if (!rawUrl) {
      return;
    }

    const key = getZipRecruiterCandidateKey(rawUrl);
    if (key) {
      keys.add(key);
    }
  };

  for (const card of Array.from(document.querySelectorAll<HTMLElement>("[id^='job-card-']"))) {
    const rawId = card.id || "";
    const lk = rawId.startsWith("job-card-") ? rawId.slice("job-card-".length) : "";
    if (!lk) {
      continue;
    }

    const contextText = buildZipRecruiterCandidateContext(card);
    if (!isAppliedJobText(contextText)) {
      continue;
    }

    const detailUrl = new URL(window.location.href);
    detailUrl.searchParams.delete("jid");
    detailUrl.searchParams.set("lk", lk);
    addKey(detailUrl.toString());

    for (const anchor of Array.from(card.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
      addKey(anchor.href);
    }
  }

  const dataAttributeElements = Array.from(
    document.querySelectorAll<HTMLElement>(
      "[data-job-id], [data-jid], [data-jobid], [data-job]"
    )
  );

  for (const el of dataAttributeElements) {
    const jobId =
      el.getAttribute("data-job-id") ||
      el.getAttribute("data-jid") ||
      el.getAttribute("data-jobid") ||
      el.getAttribute("data-job") ||
      "";
    if (!jobId || jobId.length < 3) {
      continue;
    }

    const anchor = el.querySelector<HTMLAnchorElement>("a[href]");
    const contextText = buildZipRecruiterCandidateContext(el, anchor);
    if (!isAppliedJobText(contextText)) {
      continue;
    }

    addKey(anchor?.href);

    const detailUrl = new URL(window.location.href);
    detailUrl.searchParams.delete("lk");
    detailUrl.searchParams.set("jid", jobId);
    addKey(detailUrl.toString());
  }

  return keys;
}

function filterZipRecruiterAppliedCandidates(
  candidates: JobCandidate[]
): JobCandidate[] {
  const appliedKeys = collectZipRecruiterAppliedDedupKeys();

  return candidates.filter((candidate) => {
    if (
      isAppliedJobText(candidate.contextText) ||
      isAppliedJobText(candidate.title)
    ) {
      return false;
    }

    const key = getZipRecruiterCandidateKey(candidate.url);
    if (key && appliedKeys.has(key)) {
      return false;
    }

    for (const contextText of collectZipRecruiterCandidateDomContexts(candidate, key)) {
      if (isAppliedJobText(contextText)) {
        return false;
      }
    }

    return true;
  });
}

function collectZipRecruiterCandidateDomContexts(
  candidate: JobCandidate,
  candidateKey = getZipRecruiterCandidateKey(candidate.url)
): string[] {
  const contexts = new Set<string>();
  const seenContainers = new Set<HTMLElement>();
  const seenAnchors = new Set<HTMLAnchorElement>();
  const normalizedTitle = normalizeChoiceText(candidate.title);

  const addContext = (
    container: HTMLElement | null | undefined,
    anchor?: HTMLAnchorElement | null
  ) => {
    if (!container || seenContainers.has(container)) {
      return;
    }

    seenContainers.add(container);
    const contextText = buildZipRecruiterCandidateContext(container, anchor);
    if (contextText) {
      contexts.add(contextText);
    }
  };

  const addAnchor = (anchor: HTMLAnchorElement | null | undefined) => {
    if (!anchor || seenAnchors.has(anchor)) {
      return;
    }

    seenAnchors.add(anchor);
    const container =
      anchor.closest<HTMLElement>(
        "[id^='job-card-'], [data-job-id], [data-jid], [data-jobid], [data-job], article, li, section, div"
      ) ?? anchor.parentElement;
    addContext(container, anchor);
  };

  try {
    const parsed = new URL(candidate.url, window.location.href);
    const jid = parsed.searchParams.get("jid");
    const lk = parsed.searchParams.get("lk");

    if (lk) {
      addContext(document.getElementById(`job-card-${lk}`));
    }

    if (jid) {
      for (const selector of [
        `[data-job-id='${jid}']`,
        `[data-jid='${jid}']`,
        `[data-jobid='${jid}']`,
        `[data-job='${jid}']`,
      ]) {
        for (const el of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
          addContext(el, el.querySelector<HTMLAnchorElement>("a[href]"));
        }
      }
    }
  } catch {
    // Ignore malformed candidate URLs and keep the DOM fallbacks below.
  }

  for (const anchor of Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
    const anchorKey = getZipRecruiterCandidateKey(anchor.href);
    if (candidateKey && anchorKey === candidateKey) {
      addAnchor(anchor);
      continue;
    }

    if (
      normalizedTitle &&
      normalizeChoiceText(anchor.textContent || "") === normalizedTitle
    ) {
      addAnchor(anchor);
    }
  }

  return Array.from(contexts);
}

function getZipRecruiterCandidateKey(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl, window.location.href);
    const path = parsed.pathname.toLowerCase().replace(/\/+$/, "");
    const jid = parsed.searchParams.get("jid");
    if (jid) {
      return `ziprecruiter:jid:${jid.toLowerCase()}`;
    }

    const lk = parsed.searchParams.get("lk");
    if (lk) {
      return `ziprecruiter:lk:${lk.toLowerCase()}`;
    }

    if (
      path.startsWith("/c/") ||
      path.startsWith("/k/") ||
      path.includes("/job-details/") ||
      /\/jobs\/[^/?#]{4,}/i.test(path) ||
      /\/t-[^/?#]+/i.test(path)
    ) {
      return `ziprecruiter:path:${path}`;
    }
  } catch {
    // Fall back to the shared key normalizer below.
  }

  return getJobDedupKey(rawUrl);
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
      const contextText = buildZipRecruiterCandidateContext(el, anchor);
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
    const contextText = buildZipRecruiterCandidateContext(el);

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
    const contextText = buildCandidateContextText(
      anchor.closest<HTMLElement>("article, li, section, div"),
      anchor
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
    const contextText = buildZipRecruiterCandidateContext(card);

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
    const contextText = buildCandidateContextText(
      anchor.closest<HTMLElement>("article, li, section, div"),
      anchor
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
  const contextText = cleanText(rawContext);

  if (!url || !title) {
    return;
  }

  if (isAppliedJobText(title) || isAppliedJobText(contextText)) {
    return;
  }

  candidates.push({
    url,
    title,
    contextText,
  });
}

function buildZipRecruiterCandidateContext(
  container: HTMLElement,
  anchor?: HTMLAnchorElement | null
): string {
  const contexts = new Set<string>();
  const addContext = (value: string | null | undefined) => {
    const text = cleanText(value);
    if (text) {
      contexts.add(text);
    }
  };

  addContext(buildCandidateContextText(container, anchor));

  const metadataSelectors = [
    "[data-status]",
    "[aria-label]",
    "[title]",
    "[data-testid]",
    "[data-qa]",
    "[data-cy]",
    "[class*='applied']",
    "[id*='applied']",
  ];
  const metadataNodes = new Set<HTMLElement>([container]);

  for (const node of Array.from(
    container.querySelectorAll<HTMLElement>(metadataSelectors.join(", "))
  ).slice(0, 32)) {
    metadataNodes.add(node);
  }

  for (const node of metadataNodes) {
    addContext(
      extractZipRecruiterAppliedMetadataText(
        node.innerText || node.textContent || "",
        node.getAttribute("data-status"),
        node.getAttribute("aria-label"),
        node.getAttribute("title"),
        node.getAttribute("data-testid"),
        node.getAttribute("data-qa"),
        node.getAttribute("data-cy"),
        typeof node.className === "string" ? node.className : "",
        node.id
      )
    );
  }

  return cleanText(Array.from(contexts).join(" "));
}

function extractZipRecruiterAppliedMetadataText(
  ...values: Array<string | null | undefined>
): string {
  const signals = new Set<string>();

  for (const value of values) {
    const normalized = normalizeChoiceText(value || "");
    if (
      !normalized ||
      /\b(not applied|apply now|ready to apply|applied scientist|applied research|applied machine|applied deep|applied data)\b/.test(
        normalized
      )
    ) {
      continue;
    }

    if (
      normalized.includes("already applied") ||
      normalized.includes("previously applied") ||
      normalized.includes("you applied") ||
      normalized.includes("you ve applied") ||
      normalized.includes("you have applied") ||
      /\bapplied\b/.test(normalized)
    ) {
      signals.add("Applied");
      continue;
    }

    if (
      normalized.includes("application submitted") ||
      normalized.includes("application sent") ||
      normalized.includes("already submitted") ||
      normalized.includes("application complete") ||
      normalized.includes("application received")
    ) {
      signals.add("Application submitted");
    }
  }

  return Array.from(signals).join(" ");
}

function getCanonicalIndeedCandidateUrl(
  element: Element | null | undefined
): string | null {
  if (!isElementLike(element)) {
    return null;
  }

  const jobContainer =
    (element instanceof HTMLElement && element.hasAttribute("data-jk")
      ? element
      : element.closest<HTMLElement>("[data-jk]")) ?? null;
  const jobKey = jobContainer?.getAttribute("data-jk")?.trim();

  if (!jobKey) {
    return null;
  }

  return `/viewjob?jk=${jobKey}`;
}

function buildCandidateContextText(
  container: HTMLElement | null | undefined,
  anchor?: HTMLAnchorElement | null
): string {
  const contexts = new Set<string>();

  const addContext = (element: HTMLElement | null | undefined) => {
    if (!element) {
      return;
    }

    const text = cleanText(
      [
        element.innerText || element.textContent || "",
        element.getAttribute("aria-label") || "",
        element.getAttribute("title") || "",
        element.getAttribute("data-status") || "",
      ]
        .filter(Boolean)
        .join(" ")
    );
    if (text) {
      contexts.add(text);
    }
  };

  addContext(container);

  if (anchor) {
    let current = anchor.parentElement;
    for (let depth = 0; current && depth < 6; depth += 1) {
      if (
        current === container ||
        /^(article|li|section|main)$/i.test(current.tagName) ||
        current.getAttribute("role") === "listitem" ||
        current.hasAttribute("data-testid") ||
        /(?:job|card|result|listing)/i.test(current.className || "")
      ) {
        addContext(current);
      }
      current = current.parentElement;
    }
  }

  const anchorText = cleanText(
    [
      anchor?.getAttribute("aria-label") || "",
      anchor?.getAttribute("title") || "",
      anchor?.textContent || "",
    ]
      .filter(Boolean)
      .join(" ")
  );
  if (anchorText) {
    contexts.add(anchorText);
  }

  return (
    Array.from(contexts).sort((left, right) => right.length - left.length)[0] ??
    ""
  );
}

function buildDiceCandidateContextText(
  card: HTMLElement,
  titleAnchor?: HTMLElement | null
): string {
  const contexts = new Set<string>();

  const addContext = (element: HTMLElement | null | undefined) => {
    if (!element) {
      return;
    }

    const text = cleanText(
      [
        element.innerText || element.textContent || "",
        element.getAttribute("aria-label") || "",
        element.getAttribute("title") || "",
        element.getAttribute("data-status") || "",
      ]
        .filter(Boolean)
        .join(" ")
    );
    if (text) {
      contexts.add(text);
    }
  };

  addContext(card);

  if (titleAnchor) {
    let current = titleAnchor.parentElement;
    for (let depth = 0; current && current !== card && depth < 6; depth += 1) {
      if (
        current.getAttribute("role") === "main" ||
        current.getAttribute("role") === "article" ||
        current.hasAttribute("data-testid") ||
        /(?:job|card|content|detail|result|listing)/i.test(current.className || "")
      ) {
        addContext(current);
      }
      current = current.parentElement;
    }
  }

  addContext(titleAnchor);

  return (
    Array.from(contexts).sort((left, right) => right.length - left.length)[0] ??
    ""
  );
}

function extractMonsterEmbeddedAppliedSignal(
  record: Record<string, unknown>
): boolean {
  for (const key of ["applied", "isApplied", "alreadyApplied", "hasApplied"]) {
    if (record[key] === true) {
      return true;
    }
  }

  for (const key of [
    "applicationStatus",
    "applyStatus",
    "candidateStatus",
    "jobActivity",
    "status",
  ]) {
    const value = record[key];
    if (typeof value === "string" && isAppliedJobText(value)) {
      return true;
    }
  }

  return Object.values(record).some(
    (value) =>
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      extractMonsterEmbeddedAppliedSignal(value as Record<string, unknown>)
  );
}

function scoreCandidateContextQuality(candidate: JobCandidate): number {
  const normalizedTitle = normalizeChoiceText(candidate.title);
  const normalizedContext = normalizeChoiceText(candidate.contextText);
  let score = 0;

  if (
    normalizedTitle &&
    !isGenericRoleCtaText(candidate.title) &&
    !isCareerListingCtaText(candidate.title)
  ) {
    score += 4;
  }

  if (normalizedContext.includes("remote")) {
    score += 3;
  }
  if (normalizedContext.includes("hybrid")) {
    score += 1;
  }
  if (normalizedContext.includes("onsite") || normalizedContext.includes("on site")) {
    score += 1;
  }

  const contextLength = candidate.contextText.length;
  if (contextLength >= 40 && contextLength <= 500) {
    score += 4;
  } else if (contextLength >= 20 && contextLength <= 900) {
    score += 2;
  } else if (contextLength > 1200) {
    score -= 4;
  }

  if (
    normalizedContext.includes("create alert") ||
    normalizedContext.includes("job alert") ||
    normalizedContext.includes("search jobs")
  ) {
    score -= 3;
  }

  if (normalizedContext && normalizedTitle && normalizedContext.includes(normalizedTitle)) {
    score += 1;
  }

  return score;
}

function dedupeJobCandidates(candidates: JobCandidate[]): JobCandidate[] {
  const unique = new Map<string, JobCandidate>();

  for (const candidate of candidates) {
    const key = getJobDedupKey(candidate.url);
    if (!key || !candidate.url || !candidate.title) {
      continue;
    }

    const existing = unique.get(key);
    if (!existing) {
      unique.set(key, candidate);
      continue;
    }

    const existingScore = scoreCandidateContextQuality(existing);
    const candidateScore = scoreCandidateContextQuality(candidate);
    if (
      candidateScore > existingScore ||
      (candidateScore === existingScore &&
        candidate.contextText.length > existing.contextText.length)
    ) {
      unique.set(key, candidate);
    }
  }

  return Array.from(unique.values());
}

function collectCurrentJobSurfaceTexts(site: SiteKey | null): string[] {
  const primaryTexts = collectCurrentJobSurfaceTextsForSelectors(
    getPrimaryCurrentJobSurfaceSelectors(site),
    site
  );
  if (primaryTexts.length > 0) {
    return primaryTexts;
  }

  const fallbackTexts = collectCurrentJobSurfaceTextsForSelectors(
    getFallbackCurrentJobSurfaceSelectors(),
    site
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

function getFallbackCurrentJobSurfaceSelectors(): string[] {
  return [
    "[role='main']",
    "main",
    "article",
  ];
}

function collectCurrentJobSurfaceElements(selectors: string[]): HTMLElement[] {
  const elements: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();

  for (const selector of selectors) {
    let matches: HTMLElement[];
    try {
      matches = Array.from(document.querySelectorAll<HTMLElement>(selector));
    } catch {
      continue;
    }

    for (const element of matches) {
      if (seen.has(element)) {
        continue;
      }

      seen.add(element);
      elements.push(element);
    }
  }

  return elements;
}

function collectCurrentJobSurfaceTextsForSelectors(
  selectors: string[],
  site: SiteKey | null
): string[] {
  const texts: string[] = [];
  const seen = new Set<string>();

  for (const element of collectCurrentJobSurfaceElements(selectors)) {
    if (!isReadableSurfaceElement(element)) {
      continue;
    }
    if (element.closest("aside, nav, header, footer")) {
      continue;
    }

    const text = cleanText(getCurrentJobSurfaceText(element, site))
      .toLowerCase()
      .slice(0, 12000);
    if (!text || text.length < 40 || seen.has(text)) {
      continue;
    }

    seen.add(text);
    texts.push(text);
  }

  return texts.sort((a, b) => b.length - a.length).slice(0, 4);
}

function getCurrentJobSurfaceText(
  element: HTMLElement,
  site: SiteKey | null
): string {
  if (site !== "dice") {
    return element.innerText || element.textContent || "";
  }

  const clone = element.cloneNode(true) as HTMLElement;
  const diceNestedResultSelectors = [
    ...getDiceNestedResultSelectors(),
    "a[data-testid='job-search-job-detail-link']",
    "a[data-testid='job-search-job-card-link']",
  ];

  for (const nested of Array.from(
    clone.querySelectorAll<HTMLElement>(diceNestedResultSelectors.join(", "))
  )) {
    const removalTarget =
      nested.matches(
        "a[data-testid='job-search-job-detail-link'], a[data-testid='job-search-job-card-link']"
      )
        ? nested.closest<HTMLElement>(
            "li, article, section, div, dhi-search-card, dhi-job-card"
          ) ?? nested
        : nested;

    if (removalTarget && removalTarget !== clone) {
      removalTarget.remove();
    }
  }

  return clone.innerText || clone.textContent || "";
}

function hasVisibleDiceApplySignal(): boolean {
  const surfaceElements = collectCurrentJobSurfaceElements([
    ...getPrimaryCurrentJobSurfaceSelectors("dice"),
    ...getFallbackCurrentJobSurfaceSelectors(),
  ]);
  const applySelectors = [
    "[data-testid='apply-button']",
    "[data-testid*='apply' i]",
    "[data-cy='apply-button']",
    "[data-cy*='apply']",
    "apply-button-wc",
    "button",
    "a[href]",
    "[role='button']",
    "input[type='submit']",
    "input[type='button']",
  ];

  for (const surface of surfaceElements) {
    if (!isReadableSurfaceElement(surface)) {
      continue;
    }

    for (const control of Array.from(
      surface.querySelectorAll<HTMLElement>(applySelectors.join(", "))
    )) {
      if (!isReadableSurfaceElement(control)) {
        continue;
      }
      if (isDiceNestedResultElement(control, surface)) {
        continue;
      }

      const text = cleanText(
        [
          control.innerText || control.textContent || "",
          control.getAttribute("aria-label"),
          control.getAttribute("title"),
          control.getAttribute("data-testid"),
          control.getAttribute("data-cy"),
        ]
          .filter(Boolean)
          .join(" ")
      ).toLowerCase();

      if (!text || !text.includes("apply")) {
        continue;
      }

      if (
        ["save", "share", "alert", "job alert", "applied", "already applied"].some(
          (token) => text.includes(token)
        )
      ) {
        continue;
      }

      return true;
    }
  }

  return false;
}

function hasVisibleZipRecruiterAppliedSignal(): boolean {
  const surfaceElements = collectCurrentJobSurfaceElements([
    ...getPrimaryCurrentJobSurfaceSelectors("ziprecruiter"),
    ...getFallbackCurrentJobSurfaceSelectors(),
  ]);
  const appliedSelectors = [
    "button",
    "a[href]",
    "[role='button']",
    "input[type='submit']",
    "input[type='button']",
  ];

  for (const surface of surfaceElements) {
    if (!isReadableSurfaceElement(surface)) {
      continue;
    }

    for (const control of Array.from(
      surface.querySelectorAll<HTMLElement>(appliedSelectors.join(", "))
    )) {
      if (!isReadableSurfaceElement(control)) {
        continue;
      }

      const text = cleanText(
        [
          control.innerText || control.textContent || "",
          control.getAttribute("aria-label"),
          control.getAttribute("title"),
          control.getAttribute("value"),
          control.getAttribute("data-testid"),
          control.getAttribute("data-qa"),
        ]
          .filter(Boolean)
          .join(" ")
      ).toLowerCase();

      if (!text) {
        continue;
      }

      if (
        /\b(not applied|apply now|ready to apply|applied scientist|applied research|applied machine|applied deep|applied data|applied ai)\b/.test(
          text
        )
      ) {
        continue;
      }

      if (
        [
          /^\s*applied\s*$/i,
          /\balready applied\b/i,
          /\byou already applied\b/i,
          /\byou applied\b/i,
          /\bpreviously applied\b/i,
          /\bapplication submitted\b/i,
          /\bapplication complete\b/i,
          /\bapplication received\b/i,
          /\bapplied\s+\d+\s+(minute|hour|day|week|month)s?\s+ago\b/i,
        ].some((pattern) => pattern.test(text))
      ) {
        return true;
      }

      if (/\bapplied\b/i.test(text)) {
        return true;
      }
    }
  }

  return false;
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

  const annotatedCandidates = candidates.map((candidate) => ({
    candidate,
    ageHours: extractPostedAgeHours(candidate.contextText),
  }));
  const hasKnownPostedAge = annotatedCandidates.some(
    (entry) => entry.ageHours !== null
  );

  if (!hasKnownPostedAge) {
    return candidates;
  }

  return annotatedCandidates
    .filter((entry) => entry.ageHours !== null && entry.ageHours <= maxAgeHours)
    .map((entry) => entry.candidate);
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
