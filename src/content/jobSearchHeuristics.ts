import { type DatePostedWindow, type ResumeKind, type SiteKey } from "../shared";
import { cleanText, normalizeChoiceText } from "./text";
import { type JobCandidate } from "./types";

export function shouldFilterBoardResultsByKeyword(
  site: SiteKey | null,
  eligibleCount: number,
  matchedCount: number
): boolean {
  if (matchedCount <= 0 || eligibleCount <= 0) {
    return false;
  }

  if (site === "ziprecruiter") {
    return matchedCount >= Math.max(2, eligibleCount - 1) && matchedCount >= 2;
  }

  return matchedCount >= Math.min(3, Math.max(1, Math.ceil(eligibleCount / 2)));
}

export function matchesConfiguredSearchKeywords(
  candidate: JobCandidate,
  searchKeywords: string[]
): boolean {
  return scoreCandidateKeywordRelevance(candidate, searchKeywords) > 0;
}

export function scoreCandidateKeywordRelevance(
  candidate: JobCandidate,
  searchKeywords: string[]
): number {
  const haystack = normalizeChoiceText(`${candidate.title} ${candidate.contextText}`);
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
    const matchedTokens = keywordTokens.filter((token) => haystackTokens.has(token)).length;
    const score = Math.round((matchedTokens / keywordTokens.length) * 100);
    bestScore = Math.max(bestScore, score);
  }

  return bestScore >= 75 ? bestScore : 0;
}

export function looksLikeTechnicalRoleTitle(text: string): boolean {
  const normalized = normalizeChoiceText(text);
  if (!normalized) {
    return false;
  }

  const strongSignals = [
    "software engineer",
    "software developer",
    "frontend engineer",
    "front end engineer",
    "backend engineer",
    "back end engineer",
    "full stack",
    "platform engineer",
    "site reliability",
    "sre",
    "devops",
    "qa engineer",
    "test engineer",
    "web engineer",
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
  const broadSignals = ["engineer", "developer", "architect"];
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

export function isAppliedJobText(text: string): boolean {
  if (!text) {
    return false;
  }

  const normalized = cleanText(text).toLowerCase();
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

  if (appliedRolePatterns.some((pattern) => pattern.test(normalized))) {
    return false;
  }

  if (/\b(not applied|apply now|ready to apply)\b/.test(normalized)) {
    return false;
  }

  return getAppliedStatusPatterns(true).some((pattern) => pattern.test(normalized));
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

  return getAppliedStatusPatterns(false).some((pattern) => pattern.test(normalized));
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

  let minAttemptsBeforeEarlyStop = 5;
  let stableThreshold = 4;

  if (
    site === "startup" ||
    site === "other_sites" ||
    site === "greenhouse" ||
    site === "builtin"
  ) {
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

export function filterCandidatesByDatePostedWindow(
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
  const hasKnownPostedAge = annotatedCandidates.some((entry) => entry.ageHours !== null);

  if (!hasKnownPostedAge) {
    return candidates;
  }

  return annotatedCandidates
    .filter((entry) => entry.ageHours !== null && entry.ageHours <= maxAgeHours)
    .map((entry) => entry.candidate);
}

export function sortCandidatesByRecency(
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

export function comparePostedAgeHours(
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

export function extractPostedAgeHours(text: string): number | null {
  const raw = cleanText(text).toLowerCase();
  const normalized = normalizeChoiceText(text).replace(/\s+/g, " ");
  if (!normalized) {
    return null;
  }
  if (/\bjust posted\b/.test(normalized)) {
    return 0;
  }
  if (
    /\b(?:posted|active|updated|listed|reposted)\s+today\b/.test(normalized) ||
    /\bnew today\b/.test(normalized)
  ) {
    return 12;
  }
  if (/\b(?:posted|active|updated|listed|reposted)\s+yesterday\b/.test(normalized)) {
    return 24;
  }

  const compactPlusMatch = raw.match(
    /\b(\d+)\s*(hours?|hrs?|hr|h|days?|d|weeks?|w|months?|mos?|mo)\+(?=\s|$)/
  );
  if (compactPlusMatch) {
    return convertAgeValueToHours(compactPlusMatch[1], compactPlusMatch[2]);
  }

  const explicitAgoMatch = normalized.match(
    /\b(?:(?:posted|active|updated|listed|reposted)\s+)?(\d+)\+?\s*(hours?|hrs?|hr|h|days?|d|weeks?|w|months?|mos?|mo)\s+ago\b/
  );
  if (explicitAgoMatch) {
    return convertAgeValueToHours(explicitAgoMatch[1], explicitAgoMatch[2]);
  }

  const postedWithinMatch = normalized.match(
    /\b(?:posted|active|updated|listed|reposted)\s+(\d+)\+?\s*(hours?|hrs?|hr|h|days?|d|weeks?|w|months?|mos?|mo)\b/
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

export function scoreJobTitleForResume(title: string, resumeKind: ResumeKind): number {
  const normalizedTitle = title.toLowerCase();

  switch (resumeKind) {
    case "front_end": {
      let score = 0;
      if (/\b(front\s*end|frontend|ui engineer|ui developer|react|angular|vue)\b/.test(normalizedTitle)) {
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
      if (/\b(back\s*end|backend|server|api|platform engineer)\b/.test(normalizedTitle)) {
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

function getAppliedStatusPatterns(includeLooseAppliedPattern: boolean): RegExp[] {
  const patterns = [
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
  ];

  if (includeLooseAppliedPattern) {
    patterns.splice(15, 0, /\bapplied\b(?=\s*(?:[|,.:;)\]]|$))/);
  }

  return patterns;
}
