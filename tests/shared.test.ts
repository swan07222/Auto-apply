import { describe, expect, it } from "vitest";

import {
  DEFAULT_SETTINGS,
  buildOtherJobSiteTargets,
  buildSearchTargets,
  buildStartupSearchTargets,
  detectSiteFromUrl,
  getJobDedupKey,
  inferResumeKindFromTitle,
  isStartupCompaniesCacheFresh,
  isProbablyHumanVerificationPage,
  normalizeQuestionKey,
  resolveStartupRegion,
  sanitizeStartupCompaniesPayload,
  sanitizeAutomationSettings,
} from "../src/shared";

describe("shared automation target logic", () => {
  it("detects supported job-board domains across host variants", () => {
    expect(
      detectSiteFromUrl("https://www.monster.com/jobs/q-developer-jobs")
    ).toBe("monster");
    expect(
      detectSiteFromUrl("https://jobview.monster.co.uk/job/example")
    ).toBe("monster");
    expect(
      detectSiteFromUrl("https://www.glassdoor.co.uk/job-listing/example-role-JV.htm?jl=123")
    ).toBe("glassdoor");
    expect(
      detectSiteFromUrl("https://boards.greenhouse.io/example")
    ).toBeNull();
  });

  it("builds remote Monster search targets with the current form-based search URL", () => {
    const targets = buildSearchTargets(
      "monster",
      "https://www.monster.com"
    );

    expect(targets).toHaveLength(3);
    const firstUrl = new URL(targets[0].url);
    const secondUrl = new URL(targets[1].url);

    expect(firstUrl.pathname).toBe("/jobs/search");
    expect(firstUrl.searchParams.get("q")).toBe("front end developer");
    expect(firstUrl.searchParams.get("where")).toBe("remote");
    expect(firstUrl.searchParams.get("so")).toBe("m.h.s");

    expect(secondUrl.pathname).toBe("/jobs/search");
    expect(secondUrl.searchParams.get("q")).toBe("back end developer");
    expect(secondUrl.searchParams.get("where")).toBe("remote");
  });

  it("builds remote Glassdoor search targets using the jobs route", () => {
    const targets = buildSearchTargets(
      "glassdoor",
      "https://www.glassdoor.com"
    );

    expect(targets).toHaveLength(3);
    const firstUrl = new URL(targets[0].url);

    expect(firstUrl.pathname).toBe("/Job/jobs.htm");
    expect(firstUrl.searchParams.get("sc.keyword")).toBe(
      "remote front end developer"
    );
    expect(firstUrl.searchParams.get("locT")).toBe("N");
    expect(firstUrl.searchParams.get("locId")).toBe("1");
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
    expect(urls).toContain("https://careers.veeva.com/job-search-results/");
    expect(urls).not.toContain("https://job-boards.greenhouse.io/monzo");
  });

  it("includes Veeva in UK and EU startup targets", () => {
    const ukSettings = {
      ...DEFAULT_SETTINGS,
      startupRegion: "uk" as const,
      candidate: {
        ...DEFAULT_SETTINGS.candidate,
        country: "United Kingdom",
      },
    };
    const euSettings = {
      ...DEFAULT_SETTINGS,
      startupRegion: "eu" as const,
      candidate: {
        ...DEFAULT_SETTINGS.candidate,
        country: "Germany",
      },
    };

    expect(buildStartupSearchTargets(ukSettings).map((target) => target.url)).toContain(
      "https://careers.veeva.com/job-search-results/"
    );
    expect(buildStartupSearchTargets(euSettings).map((target) => target.url)).toContain(
      "https://careers.veeva.com/job-search-results/"
    );
  });

  it("builds startup targets from refreshed company lists when provided", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      startupRegion: "us" as const,
      candidate: {
        ...DEFAULT_SETTINGS.candidate,
        country: "United States",
      },
    };

    const targets = buildStartupSearchTargets(settings, [
      {
        name: "Updated US Startup",
        careersUrl: "https://jobs.ashbyhq.com/updated-us-startup",
        regions: ["us"],
      },
      {
        name: "Updated EU Startup",
        careersUrl: "https://job-boards.greenhouse.io/updated-eu-startup",
        regions: ["eu"],
      },
    ]);

    expect(targets.map((target) => target.url)).toEqual([
      "https://jobs.ashbyhq.com/updated-us-startup",
    ]);
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

  it("normalizes dedup keys for Monster, Glassdoor, and ATS job URLs", () => {
    expect(
      getJobDedupKey("https://www.monster.com/job-opening/frontend-engineer?jobid=ABC123")
    ).toBe("monster.com/job-openings/frontend-engineer?jobid=abc123");
    expect(
      getJobDedupKey(
        "https://www.glassdoor.com/job-listing/frontend-engineer-example-co-JV_IC1147401_KO0,17_KE18,28.htm?jl=1010069347428"
      )
    ).toBe("glassdoor:jl:1010069347428");
    expect(
      getJobDedupKey("https://boards.greenhouse.io/example/jobs/1234567?gh_jid=1234567#apply")
    ).toBe("boards.greenhouse.io/example/jobs/1234567?gh_jid=1234567");
  });

  it("infers resume kind from technical job titles", () => {
    expect(inferResumeKindFromTitle("Senior React Engineer")).toBe("front_end");
    expect(inferResumeKindFromTitle("Platform API Engineer")).toBe("back_end");
    expect(inferResumeKindFromTitle("Full Stack Engineer")).toBe("full_stack");
  });

  it("detects verification surfaces from text and selector signals", () => {
    document.title = "Verify you are human";
    document.body.innerHTML = `<main>Please complete the security check.</main>`;
    expect(isProbablyHumanVerificationPage(document)).toBe(true);

    document.title = "Jobs";
    document.body.innerHTML = `<div class="cf-turnstile"></div>`;
    expect(isProbablyHumanVerificationPage(document)).toBe(true);

    document.title = "Careers";
    document.body.innerHTML = `<main><h1>Open roles</h1><p>Find your next job.</p></main>`;
    expect(isProbablyHumanVerificationPage(document)).toBe(false);
  });

  it("detects DataDome-style verification pages used by Monster", () => {
    document.title = "monster.com";
    document.body.innerHTML = `
      <iframe
        src="https://geo.captcha-delivery.com/captcha/?initialCid=test"
        title="DataDome CAPTCHA"
      ></iframe>
    `;

    expect(isProbablyHumanVerificationPage(document)).toBe(true);
  });

  it("detects Glassdoor verification pages from their blocking copy", () => {
    document.title = "Just a moment...";
    document.body.innerHTML = `
      <main>
        <h1>Help Us Protect Glassdoor</h1>
        <p>Please help us protect Glassdoor by verifying that you're a real person.</p>
      </main>
    `;

    expect(isProbablyHumanVerificationPage(document)).toBe(true);
  });

  it("does not treat application forms with embedded captcha markers as verification pages", () => {
    document.title = "Apply";
    document.body.innerHTML = `
      <main>
        <h1>Submit Your Application</h1>
        <label>Resume/CV <input type="file" /></label>
        <label>Full name <input type="text" /></label>
        <label>Email <input type="email" /></label>
        <div data-sitekey="test-key"></div>
      </main>
    `;

    expect(isProbablyHumanVerificationPage(document)).toBe(false);
  });

  it("sanitizes automation settings and stored answers", () => {
    const settings = sanitizeAutomationSettings({
      jobPageLimit: 999,
      autoUploadResumes: false,
      searchMode: "other_job_sites",
      startupRegion: "uk",
      datePostedWindow: "24h",
      candidate: {
        fullName: "  Ada Lovelace  ",
        email: " ada@example.com ",
        country: " United Kingdom ",
      },
      resumes: {
        front_end: {
          name: "resume.pdf",
          type: "application/pdf",
          dataUrl: "data:application/pdf;base64,abc",
          textContent: "resume",
          size: 42,
          updatedAt: 123,
        },
      },
      answers: {
        " why do you want this role? ": {
          question: "Why do you want this role?",
          value: "Impact and scope.",
          updatedAt: 456,
        },
      },
    });

    expect(settings.jobPageLimit).toBe(25);
    expect(settings.autoUploadResumes).toBe(false);
    expect(settings.searchMode).toBe("other_job_sites");
    expect(settings.startupRegion).toBe("uk");
    expect(settings.datePostedWindow).toBe("24h");
    expect(settings.candidate.fullName).toBe("Ada Lovelace");
    expect(settings.candidate.email).toBe("ada@example.com");
    expect(settings.candidate.country).toBe("United Kingdom");
    expect(settings.resumes.front_end?.name).toBe("resume.pdf");
    expect(settings.answers[normalizeQuestionKey("Why do you want this role?")]?.value).toBe(
      "Impact and scope."
    );
  });

  it("sanitizes startup company feeds and cache freshness", () => {
    const companies = sanitizeStartupCompaniesPayload({
      companies: [
        {
          name: " Example Co ",
          careersUrl: "https://jobs.example.com/company#openings",
          regions: ["us", "invalid", "uk"],
        },
        {
          name: "Duplicate Example",
          careersUrl: "https://jobs.example.com/company",
          regions: ["us"],
        },
        {
          name: "",
          careersUrl: "not-a-url",
          regions: ["eu"],
        },
      ],
    });

    expect(companies).toEqual([
      {
        name: "Duplicate Example",
        careersUrl: "https://jobs.example.com/company",
        regions: ["us"],
      },
    ]);

    expect(
      isStartupCompaniesCacheFresh({
        companies,
        updatedAt: Date.now(),
        sourceUrl: "https://example.com/startup-companies.json",
      })
    ).toBe(true);

    expect(
      isStartupCompaniesCacheFresh({
        companies,
        updatedAt: Date.now() - 25 * 60 * 60 * 1000,
        sourceUrl: "https://example.com/startup-companies.json",
      })
    ).toBe(false);
  });
});
