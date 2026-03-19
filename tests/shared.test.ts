import { describe, expect, it } from "vitest";

import {
  DEFAULT_SETTINGS,
  buildOtherJobSiteTargets,
  buildSearchTargets,
  buildStartupSearchTargets,
  detectSiteFromUrl,
  getJobDedupKey,
  inferResumeKindFromTitle,
  isProbablyHumanVerificationPage,
  normalizeQuestionKey,
  resolveStartupRegion,
  sanitizeAutomationSettings,
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

  it("normalizes dedup keys for Monster and ATS job URLs", () => {
    expect(
      getJobDedupKey("https://www.monster.com/job-opening/frontend-engineer?jobid=ABC123")
    ).toBe("monster.com/job-openings/frontend-engineer?jobid=abc123");
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
});
