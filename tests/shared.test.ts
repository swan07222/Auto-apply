import { describe, expect, it } from "vitest";

import {
  DEFAULT_SETTINGS,
  buildOtherJobSiteTargets,
  buildSearchTargets,
  buildStartupSearchTargets,
  detectSiteFromUrl,
  resolveStartupRegion,
} from "../src/shared";

describe("shared automation target logic", () => {
  it("detects Monster domains across host variants", () => {
    expect(
      detectSiteFromUrl("https://www.monster.com/jobs/q-developer-jobs")
    ).toBe("monster");
    expect(
      detectSiteFromUrl("https://jobview.monster.co.uk/job/example")
    ).toBe("monster");
    expect(
      detectSiteFromUrl("https://boards.greenhouse.io/example")
    ).toBeNull();
  });

  it("builds remote Monster search targets with the current path format", () => {
    const targets = buildSearchTargets(
      "monster",
      "https://www.monster.com"
    );

    expect(targets).toHaveLength(3);
    expect(targets[0].url).toContain(
      "/jobs/q-front-end-developer-jobs-l-remote"
    );
    expect(targets[1].url).toContain(
      "/jobs/q-back-end-developer-jobs-l-remote"
    );
  });

  it("resolves startup region from candidate country", () => {
    expect(resolveStartupRegion("auto", "United States")).toBe("us");
    expect(resolveStartupRegion("auto", "United Kingdom")).toBe("uk");
    expect(resolveStartupRegion("auto", "Germany")).toBe("eu");
    expect(resolveStartupRegion("us", "Germany")).toBe("us");
  });

  it("builds US startup targets from direct ATS boards where configured", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      startupRegion: "us" as const,
      candidate: {
        ...DEFAULT_SETTINGS.candidate,
        country: "United States",
      },
    };

    const targets = buildStartupSearchTargets(settings);
    const urls = targets.map((target) => target.url);

    expect(urls).toContain("https://jobs.ashbyhq.com/ramp");
    expect(urls).toContain("https://job-boards.greenhouse.io/vercel");
    expect(urls).toContain("https://jobs.lever.co/plaid");
    expect(urls).toContain("https://job-boards.greenhouse.io/figma");
    expect(urls).not.toContain("https://job-boards.greenhouse.io/monzo");
  });

  it("builds US curated other-site targets with the updated Built In routes", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      startupRegion: "us" as const,
      candidate: {
        ...DEFAULT_SETTINGS.candidate,
        country: "United States",
      },
    };

    const targets = buildOtherJobSiteTargets(settings);
    const urls = targets.map((target) => target.url);

    expect(urls).toContain(
      "https://builtin.com/jobs/remote/dev-engineering/front-end"
    );
    expect(urls).toContain(
      "https://builtin.com/jobs/remote/dev-engineering/back-end"
    );
    expect(urls).toContain(
      "https://builtin.com/jobs/remote/dev-engineering/full-stack"
    );
    expect(urls).toContain(
      "https://www.workatastartup.com/jobs?query=front%20end%20developer"
    );
  });
});
