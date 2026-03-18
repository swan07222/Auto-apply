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
            "article",
            "section",
            "li",
          ],
          [
            "a[href*='/job-openings/']",
            "a[href*='/job-opening/']",
            "a[href*='monster.com/job/']",
            "a[href*='/jobs/search/']",
            "a[href*='/jobs/l-']",
            "a[href*='/jobs/q-']",
            "a[href*='job-openings.monster.com']",
            "a[href*='jobview.monster.com']",
            "a[data-testid*='job']",
            "a[data-testid='jobTitle']",
            "a[data-testid='job-title']",
            "a[class*='job']",
            "a[class*='title']",
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
          ]
        ),
        ...collectCandidatesFromAnchors([
          "a[href*='/job-openings/']",
          "a[href*='/job-opening/']",
          "a[href*='monster.com/job/']",
          "a[href*='/jobs/l-']",
          "a[href*='/jobs/q-']",
          "a[href*='job-openings.monster.com']",
          "a[href*='jobview.monster.com']",
          "a[data-testid*='job']",
          "a[data-testid='jobTitle']",
          "a[data-testid='job-title']",
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

    case "monster":
      return (
        lowerUrl.includes("/job-openings/") ||
        lowerUrl.includes("/job-opening/") ||
        lowerUrl.includes("monster.com/job/") ||
        (lowerUrl.includes("monster.com/jobs/") &&
          !lowerUrl.endsWith("/jobs/") &&
          !lowerUrl.includes("/jobs/search")) ||
        lowerUrl.includes("job-openings.monster.com/") ||
        lowerUrl.includes("jobview.monster.com") ||
        lowerUrl.includes("m=portal&a=details")
      );

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
        return true;
      }

      const hasCareerPath = lowerUrl.includes("/careers/") || lowerUrl.includes("/career/");
      if (hasCareerPath) {
        try {
          const parsed = new URL(lowerUrl);
          const path = parsed.pathname.toLowerCase().replace(/\/+$/, "");
          const segments = path.split("/").filter(Boolean);
          if (segments.length >= 2) {
            return true;
          }
        } catch {
          // Ignore malformed URLs and fall back to title scoring.
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

  for (const container of Array.from(
    document.querySelectorAll<HTMLElement>(containerSelectors.join(","))
  )) {
    const anchor = container.querySelector<HTMLAnchorElement>(linkSelectors.join(","));
    const title =
      cleanText(container.querySelector<HTMLElement>(titleSelectors.join(","))?.textContent) ||
      cleanText(anchor?.textContent) ||
      cleanText(container.getAttribute("data-testid")) ||
      "";
    const contextText = cleanText(container.innerText || container.textContent || "");

    if (!anchor) {
      const dataJk = container.getAttribute("data-jk");
      if (dataJk) {
        addJobCandidate(candidates, `/viewjob?jk=${dataJk}`, title, contextText);
      }
      continue;
    }

    addJobCandidate(candidates, anchor.href, title, contextText);
  }

  return candidates;
}

function collectCandidatesFromAnchors(selectors: string[]): JobCandidate[] {
  const candidates: JobCandidate[] = [];

  for (const anchor of Array.from(document.querySelectorAll<HTMLAnchorElement>(selectors.join(",")))) {
    addJobCandidate(
      candidates,
      anchor.href,
      cleanText(anchor.textContent),
      cleanText(anchor.closest("article, li, section, div")?.textContent || anchor.textContent || "")
    );
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
      ].some((skip) => text.toLowerCase().includes(skip))
    ) {
      continue;
    }

    const isJobUrl =
      href.includes("/job-opening") ||
      href.includes("/job/") ||
      href.includes("job-openings.monster") ||
      href.includes("jobview.monster") ||
      (href.includes("monster.com") &&
        href.includes("/jobs/") &&
        !href.endsWith("/jobs/") &&
        !href.includes("/jobs/search"));

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
