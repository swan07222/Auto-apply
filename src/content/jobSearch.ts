// src/content/jobSearch.ts
// COMPLETE FILE — replace entirely

import { ResumeKind, SiteKey, getJobDedupKey } from "../shared";
import { JobCandidate } from "./types";
import { cleanText, normalizeChoiceText } from "./text";
import { normalizeUrl } from "./dom";

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
            "article",
            "section",
            "li",
          ],
          [
            "a[href*='/jobs/' i]",
            "a[href*='/job/' i]",
            "a[href*='/job-details/' i]",
            "a[href*='/k/' i]",
            "a[href*='?jid=' i]",
            "a[href*='/c/' i][href*='/job/' i]",
            "a[data-testid*='job-title']",
            "a[class*='job']",
            "a[class*='job_link']",
            "a[data-testid='job-title']",
          ],
          [
            "h1",
            "h2",
            "h3",
            "[data-testid*='job-title']",
            "[class*='job_title']",
          ]
        ),
        ...collectCandidatesFromAnchors([
          "a[href*='/jobs/' i]",
          "a[href*='/job/' i]",
          "a[href*='/job-details/' i]",
          "a[href*='/k/' i]",
          "a[href*='?jid=' i]",
          "a[href*='/c/' i][href*='/job/' i]",
          "a[data-testid*='job-title']",
          "a[data-testid='job-title']",
        ]),
      ]);

    case "dice":
      return dedupeJobCandidates(
        collectCandidatesFromAnchors([
          "a[href*='/job-detail/']",
          "a[href*='/jobs/detail/']",
          "a[data-cy*='job']",
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
            // FIX: Additional Monster container patterns
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
            // FIX: Additional Monster anchor patterns
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
            // FIX: Additional career site container patterns
            "[class*='career']",
            "[class*='Career']",
            "[class*='openings']",
            "[class*='Openings']",
            "article",
            "section",
            "li",
          ],
          [
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
            "a[href*='/job-posting/']",
            "a[href*='/job-postings/']",
            "a[href*='/requisition/']",
            "a[href*='/req/']",
            "a[href*='gh_jid=']",
            "a[href*='lever.co']",
            "a[href*='jobs.lever.co']",
            "a[href*='greenhouse.io']",
            "a[href*='job-boards.greenhouse.io']",
            "a[href*='boards.greenhouse.io']",
            "a[href*='ashbyhq.com']",
            "a[href*='jobs.ashbyhq.com']",
            "a[href*='workable.com']",
            "a[href*='jobvite.com']",
            "a[href*='jobs.jobvite.com']",
            "a[href*='myworkdayjobs.com']",
            "a[href*='workdayjobs.com']",
            "a[href*='icims.com/jobs/']",
            "a[href*='smartrecruiters.com']",
            "a[href*='applytojob.com']",
            "a[href*='recruitee.com']",
            "a[href*='breezy.hr']",
            "a[href*='bamboohr.com']",
          ],
          ["h1", "h2", "h3", "h4", "[data-testid*='title']", "[class*='title']"]
        ),
        ...collectCandidatesFromAnchors([
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
          "a[href*='/job-posting/']",
          "a[href*='/job-postings/']",
          "a[href*='/requisition/']",
          "a[href*='/req/']",
          "a[href*='gh_jid=']",
          "a[href*='lever.co']",
          "a[href*='jobs.lever.co']",
          "a[href*='greenhouse.io']",
          "a[href*='job-boards.greenhouse.io']",
          "a[href*='boards.greenhouse.io']",
          "a[href*='ashbyhq.com']",
          "a[href*='jobs.ashbyhq.com']",
          "a[href*='workable.com']",
          "a[href*='jobvite.com']",
          "a[href*='jobs.jobvite.com']",
          "a[href*='myworkdayjobs.com']",
          "a[href*='workdayjobs.com']",
          "a[href*='icims.com/jobs/']",
          "a[href*='smartrecruiters.com']",
          "a[href*='applytojob.com']",
          "a[href*='recruitee.com']",
          "a[href*='breezy.hr']",
          "a[href*='bamboohr.com']",
        ]),
        ...collectFallbackJobCandidates(),
      ]);

    case "chatgpt":
      return [];
  }
}

export function pickRelevantJobUrls(
  candidates: JobCandidate[],
  site: SiteKey | null,
  resumeKind?: ResumeKind
): string[] {
  const valid = candidates.filter((candidate) =>
    isLikelyJobDetailUrl(site, candidate.url, candidate.title, candidate.contextText)
  );

  if (!resumeKind) {
    return valid.map((candidate) => candidate.url);
  }

  const scored = valid.map((candidate, index) => ({
    candidate,
    index,
    score: scoreJobTitleForResume(candidate.title, resumeKind),
  }));

  const preferred = scored
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.candidate.url);

  return preferred.length > 0 ? preferred : valid.map((candidate) => candidate.url);
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

    case "ziprecruiter":
      return (
        lowerUrl.includes("?jid=") ||
        lowerUrl.includes("/job-details/") ||
        lowerUrl.includes("/k/") ||
        (lowerUrl.includes("/c/") && lowerUrl.includes("/job/"))
      );

    case "dice":
      return lowerUrl.includes("/job-detail/") || lowerUrl.includes("/jobs/detail/");

    case "monster": {
      // FIX: Exclude listing/search/category pages
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

      // Explicit job detail patterns
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

      // FIX: Monster /job/ path with a slug after it
      // Matches: monster.com/job/some-title-123, monster.co.uk/job/some-title
      if (/monster\.[a-z.]+\/job\/[^/?#]+/i.test(lowerUrl)) {
        return true;
      }

      // FIX: Monster /jobs/ with an actual job slug (not a search/category)
      if (/monster\.[a-z.]+\/jobs\/[^/?#]+/i.test(lowerUrl)) {
        // Exclude search-like patterns
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
          // e.g. /jobs/some-job-title-123 => ["jobs", "some-job-title-123"]
          if (pathParts.length >= 2 && pathParts[1].length > 3) {
            return true;
          }
        } catch {
          // Fall through
        }
      }

      // FIX: Match Monster job links that have a numeric or hash-like ID in the path
      if (/monster\.[a-z.]+\/.*\/[a-f0-9-]{8,}/i.test(lowerUrl)) {
        return true;
      }

      return false;
    }

    case "startup":
    case "other_sites": {
      if (isListingOrCategoryUrl(lowerUrl)) {
        return false;
      }

      const atsSignals = [
        "gh_jid=",
        "lever.co",
        "jobs.lever.co",
        "greenhouse.io",
        "job-boards.greenhouse.io",
        "boards.greenhouse.io",
        "ashbyhq.com",
        "jobs.ashbyhq.com",
        "workable.com",
        "jobvite.com",
        "jobs.jobvite.com",
        "myworkdayjobs.com",
        "workdayjobs.com",
        "icims.com/jobs/",
        "smartrecruiters.com",
        "applytojob.com",
        "recruitee.com",
        "breezy.hr",
        "bamboohr.com",
      ];
      if (atsSignals.some((token) => lowerUrl.includes(token))) {
        return true;
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

          // FIX: Check if there's a segment after the signal segment
          for (const signal of pathSignals) {
            const trimmedSignal = signal.replace(/\//g, "");
            const signalIndex = segments.indexOf(trimmedSignal);
            if (signalIndex >= 0 && signalIndex < segments.length - 1) {
              return true;
            }
          }

          // If query params contain an ID, still count it
          if (parsed.search.length > 1) {
            return true;
          }
        } catch {
          // Fall through to title check
        }
        return looksLikeTechnicalRoleTitle(text);
      }

      const hasCareerPath = lowerUrl.includes("/careers/") || lowerUrl.includes("/career/");
      if (hasCareerPath) {
        try {
          const parsed = new URL(lowerUrl);
          const path = parsed.pathname.toLowerCase().replace(/\/+$/, "");
          const segments = path.split("/").filter(Boolean);
          // FIX: Need at least 2 segments for a detail page (e.g. /careers/software-engineer)
          if (segments.length >= 2) {
            return true;
          }
        } catch {
          // Ignore
        }

        return looksLikeTechnicalRoleTitle(text);
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
    // FIX: Additional role title keywords
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
    /\balready applied\b/,
    /\byou applied\b/,
    /\byou(?:'ve| have)? applied\b/,
    /\bapplication submitted\b/,
    /\bapplication sent\b/,
    /\bapplication status:\s*applied\b/,
    /\bjob status:\s*applied\b/,
    /\bjob activity:\s*applied\b/,
    /\bcandidate status:\s*applied\b/,
    /\bapplied on \d/,
    /\bapplied\s+\d+\s+(minute|hour|day|week|month)s?\s+ago\b/,
    /\bstatus:\s*applied\b/,
  ].some((pattern) => pattern.test(normalized));
}

export function isCurrentPageAppliedJob(): boolean {
  return isAppliedJobText(
    cleanText(document.body?.innerText || "")
      .toLowerCase()
      .slice(0, 12000)
  );
}

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

  // FIX: Build joined selectors safely
  let joinedLinkSelectors = "";
  const validLinkSelectors: string[] = [];
  for (const sel of linkSelectors) {
    try {
      document.querySelector(sel);
      validLinkSelectors.push(sel);
    } catch {
      // Skip invalid selector
    }
  }
  joinedLinkSelectors = validLinkSelectors.join(",");

  let joinedTitleSelectors = "";
  const validTitleSelectors: string[] = [];
  for (const sel of titleSelectors) {
    try {
      document.querySelector(sel);
      validTitleSelectors.push(sel);
    } catch {
      // Skip invalid selector
    }
  }
  joinedTitleSelectors = validTitleSelectors.join(",");

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

    addJobCandidate(candidates, anchor.href, titleText, contextText);
  }

  return candidates;
}

function collectCandidatesFromAnchors(selectors: string[]): JobCandidate[] {
  const candidates: JobCandidate[] = [];

  for (const selector of selectors) {
    try {
      for (const anchor of Array.from(document.querySelectorAll<HTMLAnchorElement>(selector))) {
        addJobCandidate(
          candidates,
          anchor.href,
          cleanText(anchor.textContent),
          cleanText(anchor.closest("article, li, section, div")?.textContent || anchor.textContent || "")
        );
      }
    } catch {
      // Skip invalid selectors
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
    const text = cleanText(anchor.textContent);

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

    // FIX: Expanded Monster URL matching with all known patterns
    const isJobUrl =
      href.includes("/job-opening") ||
      href.includes("/job/") ||
      href.includes("/job-detail/") ||
      href.includes("job-openings.monster") ||
      href.includes("jobview.monster") ||
      /[?&]jobid=/i.test(href) ||
      /[?&]job_id=/i.test(href) ||
      // FIX: Match /jobs/ with an actual slug (not just /jobs/ or /jobs/search)
      (href.includes("monster.") &&
        /\/jobs\/[^/?#]{4,}/.test(href) &&
        !href.includes("/jobs/search") &&
        !href.includes("/jobs/browse") &&
        !href.includes("/jobs/q-") &&
        !href.includes("/jobs/l-")) ||
      // FIX: Match Monster URLs with UUID-like IDs
      (href.includes("monster.") && /\/[a-f0-9-]{8,}(?:[?#]|$)/i.test(href));

    if (!isJobUrl) {
      continue;
    }

    addJobCandidate(
      candidates,
      anchor.href,
      text,
      cleanText(anchor.closest("article, li, section, div")?.textContent || text)
    );
  }

  return candidates;
}

function collectFallbackJobCandidates(): JobCandidate[] {
  const candidates: JobCandidate[] = [];
  const currentHost = window.location.hostname.toLowerCase();

  for (const anchor of Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
    const href = anchor.href?.toLowerCase() ?? "";
    const text = cleanText(anchor.textContent);

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
      isKnownAts = [
        "lever.co",
        "greenhouse.io",
        "ashbyhq.com",
        "workable.com",
        "jobvite.com",
        "myworkdayjobs.com",
        "workdayjobs.com",
        "icims.com",
        "smartrecruiters.com",
        "applytojob.com",
        "recruitee.com",
        "breezy.hr",
        "bamboohr.com",
      ].some((ats) => linkHost.includes(ats));
    } catch {
      continue;
    }

    if (!isSameDomain && !isKnownAts) {
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
      cleanText(anchor.closest("article, li, section, div")?.textContent || text)
    );
  }

  return candidates;
}

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

function isListingOrCategoryUrl(lowerUrl: string): boolean {
  try {
    const parsed = new URL(lowerUrl);
    const path = parsed.pathname.toLowerCase().replace(/\/+$/, "");
    const excludedPaths = [
      "/careers",
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

    return excludedPaths.includes(path);
  } catch {
    return false;
  }
}

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