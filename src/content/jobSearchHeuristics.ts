import { type DatePostedWindow, type ResumeKind, type SiteKey } from "../shared";
import { getDatePostedWindowDays } from "../shared/catalog";
import { cleanText, normalizeChoiceText } from "./text";
import { type JobCandidate } from "./types";

const BROAD_TECHNICAL_SEARCH_TOKENS = new Set([
  "software",
  "engineer",
  "engineers",
  "developer",
  "developers",
  "development",
  "technical",
  "tech",
  "programmer",
  "programmers",
  "architect",
  "architects",
]);

const TECHNICAL_SEARCH_NOISE_TOKENS = new Set([
  "a",
  "an",
  "and",
  "for",
  "in",
  "jr",
  "junior",
  "lead",
  "mid",
  "or",
  "principal",
  "remote",
  "senior",
  "sr",
  "staff",
  "states",
  "the",
  "united",
  "us",
  "usa",
]);

const MONTH_NAME_TO_INDEX: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};
const POSTED_DATE_CUE_PATTERN =
  /\b(posted|reposted|updated|listed|active|date posted|new)\b/i;
const POSTED_DATE_FRAGMENT_SPLIT_PATTERN = /[\r\n]+|[•·|]+/;
const POSTED_AGE_UNIT_PATTERN =
  "(?:minutes?|mins?|min|m|hours?|hrs?|hr|h|days?|d|weeks?|w|wks?|wk|months?|mos?|mo)";
const COMPACT_PLUS_AGE_PATTERN = new RegExp(
  `\\b(\\d+)\\s*(${POSTED_AGE_UNIT_PATTERN})\\+(?=\\s|$)`,
  "i"
);
const EXPLICIT_AGO_AGE_PATTERN = new RegExp(
  `\\b(?:(?:posted|active|updated|listed|reposted|date posted)\\s+)?(\\d+)\\+?\\s*(${POSTED_AGE_UNIT_PATTERN})\\s+ago\\b`,
  "i"
);
const POSTED_WITHIN_AGE_PATTERN = new RegExp(
  `\\b(?:posted|active|updated|listed|reposted|date posted)\\s+(\\d+)\\+?\\s*(${POSTED_AGE_UNIT_PATTERN})\\b`,
  "i"
);
const POSTED_WITHIN_RANGE_PATTERN = new RegExp(
  `\\b(?:posted|active|updated|listed|reposted|date posted)\\s+(?:within|in the last)\\s+(\\d+)\\+?\\s*(${POSTED_AGE_UNIT_PATTERN})\\b`,
  "i"
);
const EXACT_STANDALONE_AGE_PATTERN = new RegExp(
  `^(\\d+)\\+?\\s*(${POSTED_AGE_UNIT_PATTERN})(?:\\s+ago)?$`,
  "i"
);
const EXACT_PREFIXED_AGE_PATTERN = new RegExp(
  `^(?:posted|active|updated|listed|reposted|date posted|new)\\s+(\\d+)\\+?\\s*(${POSTED_AGE_UNIT_PATTERN})(?:\\s+ago)?$`,
  "i"
);
const EMBEDDED_STANDALONE_AGE_PATTERN = new RegExp(
  `\\b(\\d+)\\+?\\s*(${POSTED_AGE_UNIT_PATTERN})(?:\\s+ago)?\\b`,
  "i"
);
const RELATIVE_AGE_SIGNAL_PATTERN = new RegExp(
  `\\b\\d+\\+?\\s*(${POSTED_AGE_UNIT_PATTERN})(?:\\s+ago)?\\b`,
  "i"
);
const STANDALONE_RECENT_BADGE_PATTERN =
  /^(?:quick apply|easy apply|one click apply|one-click apply|featured)\s+new$|^new(?:\s+(?:quick apply|easy apply|featured))?$/i;
const TRAILING_RECENT_BADGE_PATTERN = /\bnew(?:\s*[|,.;:!?•])?\s*$/i;
const SEPARATED_NEW_BADGE_PATTERN = /(?:^|[|,.;:!?•])\s*new(?:\s*[|,.;:!?•]|$)/i;

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

export function shouldAllowBroadTechnicalKeywordFallback(
  searchKeywords: string[]
): boolean {
  if (searchKeywords.length === 0) {
    return false;
  }

  return searchKeywords.every((keyword) => {
    const tokens = normalizeChoiceText(keyword)
      .split(/\s+/)
      .filter(
        (token) =>
          token.length >= 2 && !TECHNICAL_SEARCH_NOISE_TOKENS.has(token)
      );

    if (tokens.length === 0) {
      return false;
    }

    const hasBroadRoleToken = tokens.some(
      (token) =>
        token === "engineer" ||
        token === "developer" ||
        token === "programmer" ||
        token === "architect"
    );

    return (
      hasBroadRoleToken &&
      tokens.every((token) => BROAD_TECHNICAL_SEARCH_TOKENS.has(token))
    );
  });
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

export function isPostedAgeWithinDateWindow(
  ageHours: number | null,
  datePostedWindow: DatePostedWindow
): boolean {
  const maxAgeHours = getMaxPostedAgeHours(datePostedWindow);
  if (maxAgeHours === null || ageHours === null) {
    return true;
  }

  return ageHours <= maxAgeHours;
}

export function extractPostedAgeHours(text: string): number | null {
  for (const fragment of buildPostedAgeFragments(text)) {
    const ageHours = extractPostedAgeHoursFromFragment(fragment);
    if (ageHours !== null) {
      return ageHours;
    }
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
  const days = getDatePostedWindowDays(datePostedWindow);
  return days === null ? null : days * 24;
}

function convertAgeValueToHours(rawValue: string, rawUnit: string): number | null {
  const value = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(value) || value < 0) {
    return null;
  }

  const unit = rawUnit.toLowerCase();
  if (
    unit === "m" ||
    unit === "min" ||
    unit === "mins" ||
    unit === "minute" ||
    unit === "minutes"
  ) {
    return 0;
  }
  if (unit === "h" || unit === "hr" || unit === "hrs" || unit === "hour" || unit === "hours") {
    return value;
  }
  if (unit === "d" || unit === "day" || unit === "days") {
    return value * 24;
  }
  if (unit === "w" || unit === "week" || unit === "weeks") {
    return value * 24 * 7;
  }
  if (unit === "wk" || unit === "wks") {
    return value * 24 * 7;
  }
  if (unit === "mo" || unit === "mos" || unit === "month" || unit === "months") {
    return value * 24 * 30;
  }
  return null;
}

function buildPostedAgeFragments(source: string): string[] {
  const fragments = new Set<string>();

  const addFragment = (value: string | null | undefined) => {
    const text = cleanText(value);
    if (text) {
      fragments.add(text);
    }
  };

  addFragment(source);

  for (const section of source.split(POSTED_DATE_FRAGMENT_SPLIT_PATTERN)) {
    addFragment(section);
  }

  return Array.from(fragments).sort((left, right) => {
    const scoreDelta = scorePostedAgeFragment(right) - scorePostedAgeFragment(left);
    if (scoreDelta !== 0) {
      return scoreDelta;
    }

    return left.length - right.length;
  });
}

function scorePostedAgeFragment(fragment: string): number {
  const normalized = normalizeChoiceText(fragment).replace(/\s+/g, " ");
  if (!normalized) {
    return -1;
  }

  let score = 0;
  if (POSTED_DATE_CUE_PATTERN.test(normalized)) {
    score += 6;
  }
  if (
    normalized === "today" ||
    normalized === "yesterday" ||
    /\b(just posted|just now|moments? ago|few moments ago|seconds? ago)\b/.test(
      normalized
    )
  ) {
    score += 5;
  }
  if (
    EXACT_STANDALONE_AGE_PATTERN.test(normalized) ||
    EXACT_PREFIXED_AGE_PATTERN.test(normalized)
  ) {
    score += 4;
  }
  if (
    RELATIVE_AGE_SIGNAL_PATTERN.test(normalized) ||
    COMPACT_PLUS_AGE_PATTERN.test(fragment) ||
    POSTED_WITHIN_RANGE_PATTERN.test(normalized)
  ) {
    score += 3;
  }
  if (looksLikeStandaloneDateOnlyFragment(fragment, normalized)) {
    score += 2;
  }
  if (normalized.length <= 40) {
    score += 1;
  }

  return score;
}

function extractPostedAgeHoursFromFragment(fragment: string): number | null {
  const cleaned = cleanText(fragment);
  const raw = cleaned.toLowerCase();
  const normalized = normalizeChoiceText(cleaned).replace(/\s+/g, " ");
  if (!normalized) {
    return null;
  }

  if (
    /\b(just posted|just now|moments? ago|few moments ago|seconds? ago)\b/.test(
      normalized
    )
  ) {
    return 0;
  }
  if (
    normalized === "new" ||
    STANDALONE_RECENT_BADGE_PATTERN.test(normalized) ||
    TRAILING_RECENT_BADGE_PATTERN.test(cleaned) ||
    SEPARATED_NEW_BADGE_PATTERN.test(cleaned)
  ) {
    return 12;
  }
  if (
    normalized === "today" ||
    /\b(?:posted|active|updated|listed|reposted|date posted)\s+today\b/.test(
      normalized
    ) ||
    /\bnew today\b/.test(normalized)
  ) {
    return 12;
  }
  if (
    normalized === "yesterday" ||
    /\b(?:posted|active|updated|listed|reposted|date posted)\s+yesterday\b/.test(
      normalized
    )
  ) {
    return 24;
  }

  const compactPlusMatch = raw.match(COMPACT_PLUS_AGE_PATTERN);
  if (compactPlusMatch) {
    return convertAgeValueToHours(compactPlusMatch[1], compactPlusMatch[2]);
  }

  const explicitAgoMatch = normalized.match(EXPLICIT_AGO_AGE_PATTERN);
  if (explicitAgoMatch) {
    return convertAgeValueToHours(explicitAgoMatch[1], explicitAgoMatch[2]);
  }

  const postedWithinMatch = normalized.match(POSTED_WITHIN_AGE_PATTERN);
  if (postedWithinMatch) {
    return convertAgeValueToHours(postedWithinMatch[1], postedWithinMatch[2]);
  }

  const postedWithinRangeMatch = normalized.match(POSTED_WITHIN_RANGE_PATTERN);
  if (postedWithinRangeMatch) {
    return convertAgeValueToHours(
      postedWithinRangeMatch[1],
      postedWithinRangeMatch[2]
    );
  }

  const exactStandaloneMatch = normalized.match(EXACT_STANDALONE_AGE_PATTERN);
  if (exactStandaloneMatch) {
    return convertAgeValueToHours(exactStandaloneMatch[1], exactStandaloneMatch[2]);
  }

  const exactPrefixedMatch = normalized.match(EXACT_PREFIXED_AGE_PATTERN);
  if (exactPrefixedMatch) {
    return convertAgeValueToHours(exactPrefixedMatch[1], exactPrefixedMatch[2]);
  }

  if (normalized.length <= 120) {
    const embeddedStandaloneMatch = normalized.match(EMBEDDED_STANDALONE_AGE_PATTERN);
    if (embeddedStandaloneMatch) {
      return convertAgeValueToHours(
        embeddedStandaloneMatch[1],
        embeddedStandaloneMatch[2]
      );
    }
  }

  if (
    POSTED_DATE_CUE_PATTERN.test(cleaned) ||
    looksLikeStandaloneDateOnlyFragment(cleaned, normalized)
  ) {
    const absoluteAge = extractAbsolutePostedAgeHours(cleaned);
    if (absoluteAge !== null) {
      return absoluteAge;
    }
  }

  return null;
}

function looksLikeStandaloneDateOnlyFragment(
  cleaned: string,
  _normalized: string
): boolean {
  return POSTED_DATE_CUE_PATTERN.test(cleaned);
}

function extractAbsolutePostedAgeHours(source: string): number | null {
  if (!source) {
    return null;
  }

  const monthDayMatch = source.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:,\s*(\d{4}))?\b/i
  );
  if (monthDayMatch) {
    return convertCalendarDateMatchToAgeHours(
      monthDayMatch[1],
      monthDayMatch[2],
      monthDayMatch[3]
    );
  }

  const dayMonthMatch = source.match(
    /\b(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?(?:,\s*|\s+)?(\d{4})?\b/i
  );
  if (dayMonthMatch) {
    return convertCalendarDateMatchToAgeHours(
      dayMonthMatch[2],
      dayMonthMatch[1],
      dayMonthMatch[3]
    );
  }

  const isoDateMatch = source.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (isoDateMatch) {
    return convertExplicitDateToAgeHours(
      Number.parseInt(isoDateMatch[1], 10),
      Number.parseInt(isoDateMatch[2], 10) - 1,
      Number.parseInt(isoDateMatch[3], 10)
    );
  }

  if (!POSTED_DATE_CUE_PATTERN.test(source)) {
    return null;
  }

  const numericDateMatch = source.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (!numericDateMatch) {
    return null;
  }

  const first = Number.parseInt(numericDateMatch[1], 10);
  const second = Number.parseInt(numericDateMatch[2], 10);
  const rawYear = numericDateMatch[3];
  if (!Number.isFinite(first) || !Number.isFinite(second)) {
    return null;
  }

  const hasExplicitYear = Boolean(rawYear);
  const year = hasExplicitYear
    ? normalizeCalendarYear(rawYear)
    : new Date().getFullYear();
  if (year === null) {
    return null;
  }

  const [monthIndex, day] =
    first > 12 && second <= 12 ? [second - 1, first] : [first - 1, second];
  return convertExplicitDateToAgeHours(
    hasExplicitYear ? year : new Date().getFullYear(),
    monthIndex,
    day,
    !hasExplicitYear
  );
}

function convertCalendarDateMatchToAgeHours(
  rawMonth: string,
  rawDay: string,
  rawYear?: string
): number | null {
  const monthIndex = MONTH_NAME_TO_INDEX[rawMonth.toLowerCase().replace(/\.$/, "")];
  const day = Number.parseInt(rawDay, 10);
  if (monthIndex === undefined || !Number.isFinite(day)) {
    return null;
  }

  const explicitYear = rawYear ? normalizeCalendarYear(rawYear) : null;
  if (rawYear && explicitYear === null) {
    return null;
  }

  return convertExplicitDateToAgeHours(
    explicitYear ?? new Date().getFullYear(),
    monthIndex,
    day,
    !rawYear
  );
}

function normalizeCalendarYear(rawYear: string): number | null {
  const parsed = Number.parseInt(rawYear, 10);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  if (rawYear.length === 2) {
    return parsed >= 70 ? 1900 + parsed : 2000 + parsed;
  }

  return parsed;
}

function convertExplicitDateToAgeHours(
  year: number,
  monthIndex: number,
  day: number,
  inferPreviousYear = false
): number | null {
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(monthIndex) ||
    !Number.isFinite(day) ||
    monthIndex < 0 ||
    monthIndex > 11 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }

  const now = new Date();
  let postedAt = new Date(year, monthIndex, day);
  if (
    postedAt.getFullYear() !== year ||
    postedAt.getMonth() !== monthIndex ||
    postedAt.getDate() !== day
  ) {
    return null;
  }

  if (inferPreviousYear && postedAt.getTime() > now.getTime() + 36 * 60 * 60 * 1000) {
    postedAt = new Date(year - 1, monthIndex, day);
  }

  if (postedAt.getTime() > now.getTime() + 36 * 60 * 60 * 1000) {
    return null;
  }

  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const postedStart = new Date(
    postedAt.getFullYear(),
    postedAt.getMonth(),
    postedAt.getDate()
  ).getTime();
  const diffDays = Math.round((todayStart - postedStart) / (24 * 60 * 60 * 1000));
  if (!Number.isFinite(diffDays) || diffDays < 0) {
    return null;
  }

  return diffDays === 0 ? 12 : diffDays * 24;
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
