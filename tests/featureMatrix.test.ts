import {
  CANONICAL_JOB_BOARD_ORIGINS,
  DATE_POSTED_WINDOW_LABELS,
  DEFAULT_SETTINGS,
  SEARCH_MODE_LABELS,
  SUPPORTED_SITE_LABELS,
  buildOtherJobSiteTargets,
  buildSearchTargets,
  buildStartupSearchTargets,
  detectSiteFromUrl,
  getSiteLabel,
  isJobBoardSite,
  type AutomationSettings,
  type JobBoardSite,
  type SiteKey,
  type StartupRegion,
} from "../src/shared";
import {
  getCareerSiteJobLinkSelectors,
  getPrimaryCurrentJobSurfaceSelectors,
  getSiteApplyCandidateSelectors,
  getSiteJobResultCollectionTargetCount,
  getSiteResultSurfaceSettleMs,
} from "../src/content/sites";

const ALL_SITES = Object.keys(SUPPORTED_SITE_LABELS) as SiteKey[];
const JOB_BOARD_CASES: Array<{
  site: JobBoardSite;
  currentUrl: string;
  assertRemoteTarget: (url: URL) => void;
}> = [
  {
    site: "indeed",
    currentUrl: CANONICAL_JOB_BOARD_ORIGINS.indeed,
    assertRemoteTarget: (url) => {
      expect(url.pathname).toBe("/jobs");
      expect(url.searchParams.get("l")).toBe("Remote");
    },
  },
  {
    site: "ziprecruiter",
    currentUrl: CANONICAL_JOB_BOARD_ORIGINS.ziprecruiter,
    assertRemoteTarget: (url) => {
      expect(url.pathname).toBe("/jobs-search");
      expect(url.searchParams.get("location")).toBe("Remote");
    },
  },
  {
    site: "dice",
    currentUrl: CANONICAL_JOB_BOARD_ORIGINS.dice,
    assertRemoteTarget: (url) => {
      expect(url.pathname).toBe("/jobs");
      expect(url.searchParams.get("filters.workplaceTypes")).toBe("Remote");
    },
  },
  {
    site: "monster",
    currentUrl: CANONICAL_JOB_BOARD_ORIGINS.monster,
    assertRemoteTarget: (url) => {
      expect(url.pathname).toBe("/jobs/search");
      expect(url.searchParams.get("where")).toBe("remote");
      expect(url.searchParams.get("page")).toBe("1");
    },
  },
  {
    site: "glassdoor",
    currentUrl: CANONICAL_JOB_BOARD_ORIGINS.glassdoor,
    assertRemoteTarget: (url) => {
      expect(url.pathname).toBe("/Job/jobs.htm");
      expect(url.searchParams.get("sc.keyword")).toContain("remote");
    },
  },
  {
    site: "greenhouse",
    currentUrl: "https://job-boards.greenhouse.io/vercel/jobs/5732855004",
    assertRemoteTarget: (url) => {
      expect(url.origin).toBe("https://job-boards.greenhouse.io");
      expect(url.pathname).toBe("/vercel");
      expect(url.search).toBe("");
    },
  },
  {
    site: "builtin",
    currentUrl: "https://builtin.com/job/software-engineer/3985663",
    assertRemoteTarget: (url) => {
      expect(url.pathname).toBe("/jobs/remote");
      expect(url.searchParams.get("search")).toBe("software engineer");
    },
  },
];

function createRegionSettings(
  region: StartupRegion,
  country: string
): AutomationSettings {
  return {
    ...DEFAULT_SETTINGS,
    startupRegion: region,
    searchKeywords: "software engineer\nfrontend engineer",
    candidate: {
      ...DEFAULT_SETTINGS.candidate,
      country,
    },
  };
}

describe("extension feature matrix", () => {
  it("keeps every supported site wired through labels, detection, and site profiles", () => {
    for (const site of ALL_SITES) {
      expect(getSiteLabel(site)).toBe(SUPPORTED_SITE_LABELS[site]);

      if (site === "startup" || site === "other_sites") {
        expect(isJobBoardSite(site)).toBe(false);
      } else {
        expect(detectSiteFromUrl(CANONICAL_JOB_BOARD_ORIGINS[site])).toBe(site);
        expect(isJobBoardSite(site)).toBe(true);
      }

      expect(getSiteApplyCandidateSelectors(site).length).toBeGreaterThan(0);
      expect(getPrimaryCurrentJobSurfaceSelectors(site).length).toBeGreaterThan(0);
      expect(getSiteJobResultCollectionTargetCount(site, 5)).toBeGreaterThanOrEqual(5);
      expect(getSiteResultSurfaceSettleMs(site)).toBeGreaterThan(0);
    }

    for (const site of ["startup", "other_sites", "greenhouse", "builtin"] as const) {
      expect(getCareerSiteJobLinkSelectors(site).length).toBeGreaterThan(0);
    }
  });

  it("builds remote-scoped search targets for every supported job board", () => {
    for (const { site, currentUrl, assertRemoteTarget } of JOB_BOARD_CASES) {
      const targets = buildSearchTargets(site, currentUrl, "software engineer");

      expect(targets).toHaveLength(1);

      const targetUrl = new URL(targets[0].url);
      expect(targets[0].label).toBe("software engineer");
      expect(targets[0].keyword).toBe("software engineer");
      assertRemoteTarget(targetUrl);
    }
  });

  it("keeps startup and other-site target builders populated across configured regions", () => {
    const usSettings = createRegionSettings("us", "United States");
    const ukSettings = createRegionSettings("uk", "United Kingdom");
    const euSettings = createRegionSettings("eu", "Germany");

    const startupUs = buildStartupSearchTargets(usSettings);
    const startupUk = buildStartupSearchTargets(ukSettings);
    const startupEu = buildStartupSearchTargets(euSettings);
    const otherUs = buildOtherJobSiteTargets(usSettings);
    const otherUk = buildOtherJobSiteTargets(ukSettings);
    const otherEu = buildOtherJobSiteTargets(euSettings);

    expect(startupUs.length).toBeGreaterThan(0);
    expect(startupUk.length).toBeGreaterThan(0);
    expect(startupEu.length).toBeGreaterThan(0);
    expect(otherUs.length).toBeGreaterThan(0);
    expect(otherUk.length).toBeGreaterThan(0);
    expect(otherEu.length).toBeGreaterThan(0);

    expect(new Set(startupUs.map((target) => target.url)).size).toBe(startupUs.length);
    expect(new Set(otherUs.map((target) => target.url)).size).toBe(otherUs.length);
    expect(otherUs.some((target) => target.label.startsWith("Built In:"))).toBe(true);
    expect(otherUk.some((target) => target.label.startsWith("Reed:"))).toBe(true);
    expect(otherEu.some((target) => target.label.startsWith("Welcome to the Jungle:"))).toBe(true);
  });

  it("exposes consistent labels for every user-selectable mode and date window", () => {
    expect(SEARCH_MODE_LABELS).toEqual({
      job_board: "Job Boards",
      startup_careers: "Startup Careers",
      other_job_sites: "Other Job Sites",
    });

    expect(DATE_POSTED_WINDOW_LABELS).toEqual({
      any: "Any time",
      "24h": "Past 24 hours",
      "2d": "Past 2 days",
      "3d": "Past 3 days",
      "5d": "Past 5 days",
      "1w": "Past week",
      "10d": "Past 10 days",
      "14d": "Past 14 days",
      "30d": "Past 30 days",
    });

    expect(SEARCH_MODE_LABELS[DEFAULT_SETTINGS.searchMode]).toBe("Job Boards");
    expect(DATE_POSTED_WINDOW_LABELS[DEFAULT_SETTINGS.datePostedWindow]).toBe("Any time");
  });
});
