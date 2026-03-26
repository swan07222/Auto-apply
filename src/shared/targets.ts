import {
  CANONICAL_JOB_BOARD_ORIGINS,
  OTHER_JOB_SITE_DEFINITIONS,
  STARTUP_COMPANIES,
  STARTUP_REGION_LABELS,
  getStartupTargetRegions,
} from "./catalog";
import type {
  AutomationSettings,
  DatePostedWindow,
  JobBoardSite,
  SearchTarget,
  StartupCompany,
  StartupRegion,
} from "./types";
import { normalizeQuestionKey } from "./storage";

export function parseSearchKeywords(value: string): string[] {
  const source = typeof value === "string" ? value : "";
  const deduped = new Map<string, string>();

  for (const rawKeyword of source.split(/[\r\n,]+/)) {
    const keyword = rawKeyword.trim();
    if (!keyword) {
      continue;
    }

    const normalized = normalizeQuestionKey(keyword);
    if (!normalized || deduped.has(normalized)) {
      continue;
    }

    deduped.set(normalized, keyword);
  }

  return Array.from(deduped.values());
}

export function hasConfiguredSearchKeywords(value: string): boolean {
  return parseSearchKeywords(value).length > 0;
}

export function buildSearchTargets(
  site: JobBoardSite,
  currentUrl: string,
  searchKeywords: string,
  candidateCountry = "",
  datePostedWindow: DatePostedWindow = "any"
): SearchTarget[] {
  return dedupeSearchTargets(
    parseSearchKeywords(searchKeywords).map((keyword) => ({
      label: keyword,
      keyword,
      url: buildSingleSearchUrl(
        site,
        keyword,
        currentUrl,
        candidateCountry,
        datePostedWindow
      ),
    }))
  );
}

export function buildStartupSearchTargets(
  settings: AutomationSettings,
  companies: StartupCompany[] = STARTUP_COMPANIES
): SearchTarget[] {
  const keywordHints = parseSearchKeywords(settings.searchKeywords).join("\n");
  const regionSet = new Set(
    resolveStartupTargetRegions(
      settings.startupRegion,
      settings.candidate.country
    )
  );
  const matchingCompanies = companies.filter((company) =>
    company.regions.some((region) => regionSet.has(region))
  );

  return dedupeSearchTargets(
    matchingCompanies.map((company) => ({
      label: company.name,
      url: company.careersUrl,
      keyword: keywordHints || undefined,
    }))
  );
}

export function buildOtherJobSiteTargets(
  settings: AutomationSettings
): SearchTarget[] {
  const regionSet = new Set(
    resolveStartupTargetRegions(
      settings.startupRegion,
      settings.candidate.country
    )
  );

  const targets: SearchTarget[] = [];
  for (const keyword of parseSearchKeywords(settings.searchKeywords)) {
    for (const site of OTHER_JOB_SITE_DEFINITIONS) {
      if (!site.regions.some((region) => regionSet.has(region))) {
        continue;
      }

      const url = site.buildUrl(keyword);
      if (!url) {
        continue;
      }

      targets.push({
        label: `${site.label}: ${keyword}`,
        keyword,
        url,
      });
    }
  }

  return dedupeSearchTargets(targets);
}

export function resolveStartupTargetRegions(
  startupRegion: StartupRegion,
  candidateCountry: string
): Array<Exclude<StartupRegion, "auto">> {
  if (startupRegion !== "auto") {
    return [startupRegion];
  }

  const inferred = inferStartupRegionFromCountry(candidateCountry);
  return inferred ? [inferred] : getStartupTargetRegions();
}

export function resolveStartupRegion(
  startupRegion: StartupRegion,
  candidateCountry: string
): Exclude<StartupRegion, "auto"> {
  return resolveStartupTargetRegions(startupRegion, candidateCountry)[0] ?? "us";
}

export function inferStartupRegionFromCountry(
  candidateCountry: string
): Exclude<StartupRegion, "auto"> | null {
  const normalized = normalizeQuestionKey(candidateCountry);

  if (!normalized) {
    return null;
  }

  if (
    ["us", "usa", "united states", "united states of america", "america"].includes(normalized)
  ) {
    return "us";
  }

  if (
    [
      "uk", "u k", "united kingdom", "great britain", "britain",
      "england", "scotland", "wales", "northern ireland",
    ].includes(normalized)
  ) {
    return "uk";
  }

  const euCountries = new Set([
    "eu", "europe", "european union", "austria", "belgium", "bulgaria",
    "croatia", "cyprus", "czech republic", "czechia", "denmark", "estonia",
    "finland", "france", "germany", "greece", "hungary", "ireland", "italy",
    "latvia", "lithuania", "luxembourg", "malta", "netherlands", "poland",
    "portugal", "romania", "slovakia", "slovenia", "spain", "sweden",
  ]);

  return euCountries.has(normalized) ? "eu" : null;
}

export function formatStartupRegionList(
  regions: ReadonlyArray<Exclude<StartupRegion, "auto">>
): string {
  return regions
    .filter((region, index, values) => values.indexOf(region) === index)
    .map((region) => STARTUP_REGION_LABELS[region])
    .join(" / ");
}

function dedupeSearchTargets(targets: SearchTarget[]): SearchTarget[] {
  const deduped = new Map<string, SearchTarget>();

  for (const target of targets) {
    const normalizedUrl = sanitizeHttpUrl(target.url);
    if (!normalizedUrl) {
      continue;
    }

    const key = `${normalizedUrl.toLowerCase()}::${target.resumeKind ?? ""}`;
    if (!deduped.has(key)) {
      deduped.set(key, {
        ...target,
        url: normalizedUrl,
      });
    }
  }

  return Array.from(deduped.values());
}

function buildSingleSearchUrl(
  site: JobBoardSite,
  query: string,
  currentUrl: string,
  candidateCountry = "",
  datePostedWindow: DatePostedWindow = "any"
): string {
  const baseOrigin = CANONICAL_JOB_BOARD_ORIGINS[site];

  switch (site) {
    case "indeed": {
      const url = new URL("/jobs", baseOrigin);
      url.searchParams.set("q", query);
      url.searchParams.set("l", "Remote");
      applyBoardDatePostedWindow(url, site, datePostedWindow);
      return url.toString();
    }
    case "ziprecruiter": {
      const url = new URL("/jobs-search", baseOrigin);
      url.searchParams.set("search", query);
      url.searchParams.set("location", "Remote");
      return url.toString();
    }
    case "dice": {
      const url = new URL("/jobs", baseOrigin);
      url.searchParams.set("q", query);
      url.searchParams.set("filters.workplaceTypes", "Remote");
      return url.toString();
    }
    case "monster":
      return buildMonsterSearchUrl(query, baseOrigin);
    case "glassdoor":
      return buildGlassdoorSearchUrl(query, baseOrigin);
    case "greenhouse":
      return buildGreenhouseSearchUrl(
        query,
        currentUrl,
        baseOrigin,
        candidateCountry
      );
    case "builtin":
      return buildBuiltInSearchUrl(query, baseOrigin);
  }
}

function applyBoardDatePostedWindow(
  url: URL,
  site: JobBoardSite,
  datePostedWindow: DatePostedWindow
): void {
  if (site !== "indeed") {
    return;
  }

  const fromAge = getIndeedFromAgeValue(datePostedWindow);
  if (!fromAge) {
    url.searchParams.delete("fromage");
    return;
  }

  url.searchParams.set("fromage", fromAge);
}

function getIndeedFromAgeValue(datePostedWindow: DatePostedWindow): string {
  switch (datePostedWindow) {
    case "24h":
      return "1";
    case "3d":
      return "3";
    case "1w":
      return "7";
    case "any":
      return "";
  }
}

function buildMonsterSearchUrl(query: string, baseOrigin: string): string {
  const url = new URL("/jobs/search", baseOrigin);
  url.searchParams.set("q", query);
  url.searchParams.set("where", "remote");
  url.searchParams.set("so", "m.h.s");
  return url.toString();
}

function buildGlassdoorSearchUrl(query: string, baseOrigin: string): string {
  const url = new URL("/Job/jobs.htm", baseOrigin);
  url.searchParams.set("sc.keyword", `remote ${query}`);
  url.searchParams.set("locT", "N");
  url.searchParams.set("locId", "1");
  return url.toString();
}

function buildBuiltInSearchUrl(query: string, baseOrigin: string): string {
  const url = new URL("/jobs/remote", baseOrigin);
  url.searchParams.set("search", query);
  return url.toString();
}

function isMyGreenhousePortalUrl(currentUrl: string): boolean {
  try {
    const parsed = new URL(currentUrl);
    return parsed.hostname.toLowerCase().replace(/^www\./, "") === "my.greenhouse.io";
  } catch {
    return false;
  }
}

function resolveGreenhouseBoardBaseUrl(currentUrl: string, fallbackOrigin: string): string {
  try {
    const parsed = new URL(currentUrl);
    const normalizedPath = parsed.pathname.replace(/\/+$/, "");
    const lowerPath = normalizedPath.toLowerCase();
    const jobsIndex = lowerPath.indexOf("/jobs/");
    const boardPath =
      jobsIndex >= 0
        ? normalizedPath.slice(0, jobsIndex)
        : lowerPath.endsWith("/jobs")
          ? normalizedPath.slice(0, -"/jobs".length)
        : normalizedPath || "/";
    return new URL(boardPath || "/", `${parsed.protocol}//${parsed.host}`).toString();
  } catch {
    return fallbackOrigin;
  }
}

function buildGreenhouseSearchUrl(
  query: string,
  currentUrl: string,
  fallbackOrigin: string,
  candidateCountry = ""
): string {
  if (isMyGreenhousePortalUrl(currentUrl)) {
    try {
      const parsed = new URL(currentUrl);
      return buildMyGreenhousePortalSearchUrl(
        `${parsed.protocol}//${parsed.host}`,
        buildMyGreenhousePortalQuery(query)
      );
    } catch {
      return currentUrl;
    }
  }

  const url = new URL(resolveGreenhouseBoardBaseUrl(currentUrl, fallbackOrigin));
  url.searchParams.set("keyword", buildGreenhouseKeywordQuery(query));
  url.searchParams.set("location", normalizeGreenhouseSearchLocation(candidateCountry));
  return url.toString();
}

function buildMyGreenhousePortalQuery(query: string): string {
  return query.trim();
}

function buildMyGreenhousePortalSearchUrl(
  origin: string,
  query: string
): string {
  return `${origin}/jobs?query=${encodeURIComponent(query)}&location=United%20States&lat=39.71614&lon=-96.999246&location_type=country&country_short_name=US&work_type[]=remote`;
}

export function buildGreenhouseKeywordQuery(query: string): string {
  const trimmed = query.trim();
  if (!trimmed) {
    return "";
  }

  return /\bremote\b/i.test(trimmed) ? trimmed : `${trimmed} remote`;
}

export function normalizeGreenhouseSearchLocation(candidateCountry: string): string {
  return normalizeGreenhouseCountryLabel(candidateCountry) || "Remote";
}

export function normalizeGreenhouseCountryShortCode(candidateCountry: string): string {
  const normalizedCountry = normalizeQuestionKey(
    normalizeGreenhouseCountryLabel(candidateCountry)
  );

  if (!normalizedCountry) {
    return "";
  }

  if (normalizedCountry === "united states") {
    return "US";
  }

  if (normalizedCountry === "united kingdom") {
    return "GB";
  }

  if (normalizedCountry === "canada") {
    return "CA";
  }

  return "";
}

export function normalizeGreenhouseCountryLabel(candidateCountry: string): string {
  const trimmedCountry = candidateCountry.trim();
  const normalizedCountry = normalizeQuestionKey(trimmedCountry);

  if (!normalizedCountry) {
    return "";
  }

  if (
    [
      "us",
      "usa",
      "u s a",
      "u s",
      "america",
      "united states",
      "united states of america",
    ].includes(normalizedCountry)
  ) {
    return "United States";
  }

  if (
    [
      "uk",
      "u k",
      "united kingdom",
      "great britain",
      "britain",
    ].includes(normalizedCountry)
  ) {
    return "United Kingdom";
  }

  return trimmedCountry;
}

function sanitizeHttpUrl(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) {
    return "";
  }

  try {
    const normalized = new URL(raw);
    if (normalized.protocol !== "http:" && normalized.protocol !== "https:") {
      return "";
    }
    normalized.hash = "";
    return normalized.toString();
  } catch {
    return "";
  }
}
