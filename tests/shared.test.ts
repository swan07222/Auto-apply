import { describe, expect, it } from "vitest";

import {
  DEFAULT_SETTINGS,
  buildOtherJobSiteTargets,
  buildSearchTargets,
  buildStartupSearchTargets,
  detectBrokenPageReason,
  detectSiteFromUrl,
  formatStartupRegionList,
  getJobDedupKey,
  inferResumeKindFromTitle,
  isProbablyAuthGatePage,
  isProbablyRateLimitPage,
  inferStartupRegionFromCountry,
  isStartupCompaniesCacheFresh,
  isProbablyHumanVerificationPage,
  normalizeQuestionKey,
  resolveStartupRegion,
  resolveStartupTargetRegions,
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
      "https://www.monster.com",
      "frontend engineer\nplatform engineer"
    );

    expect(targets).toHaveLength(2);
    const firstUrl = new URL(targets[0].url);
    expect(firstUrl.pathname).toBe("/jobs/search");
    expect(firstUrl.searchParams.get("q")).toBe("frontend engineer");
    expect(firstUrl.searchParams.get("where")).toBe("remote");
    expect(firstUrl.searchParams.get("so")).toBe("m.h.s");
    expect(
      targets.some(
        (target) =>
          new URL(target.url).searchParams.get("q") === "platform engineer"
      )
    ).toBe(true);
  });

  it("builds remote Glassdoor search targets using the jobs route", () => {
    const targets = buildSearchTargets(
      "glassdoor",
      "https://www.glassdoor.com",
      "software engineer"
    );

    expect(targets).toHaveLength(1);
    const firstUrl = new URL(targets[0].url);

    expect(firstUrl.pathname).toBe("/Job/jobs.htm");
    expect(firstUrl.searchParams.get("sc.keyword")).toBe(
      "remote software engineer"
    );
    expect(firstUrl.searchParams.get("locT")).toBe("N");
    expect(firstUrl.searchParams.get("locId")).toBe("1");
  });

  it("builds Dice search targets with the workplace-type remote filter", () => {
    const targets = buildSearchTargets(
      "dice",
      "https://www.dice.com",
      "software engineer"
    );

    expect(targets).toHaveLength(1);
    const firstUrl = new URL(targets[0].url);

    expect(firstUrl.pathname).toBe("/jobs");
    expect(firstUrl.searchParams.get("q")).toBe("software engineer");
    expect(firstUrl.searchParams.get("filters.workplaceTypes")).toBe("Remote");
    expect(firstUrl.searchParams.get("location")).toBeNull();
  });

  it("resolves startup region from candidate country", () => {
    expect(resolveStartupRegion("auto", "United States")).toBe("us");
    expect(resolveStartupRegion("auto", "United Kingdom")).toBe("uk");
    expect(resolveStartupRegion("auto", "Germany")).toBe("eu");
    expect(resolveStartupRegion("us", "Germany")).toBe("us");
    expect(inferStartupRegionFromCountry("")).toBeNull();
    expect(resolveStartupTargetRegions("auto", "")).toEqual(["us", "uk", "eu"]);
    expect(formatStartupRegionList(["us", "uk", "eu"])).toBe("US / UK / EU");
  });

  it("builds US startup targets from direct ATS boards where configured", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      startupRegion: "us" as const,
      searchKeywords: "software engineer",
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
    expect(targets.every((target) => target.resumeKind === undefined)).toBe(true);
  });

  it("includes Veeva in UK and EU startup targets", () => {
    const ukSettings = {
      ...DEFAULT_SETTINGS,
      startupRegion: "uk" as const,
      searchKeywords: "software engineer",
      candidate: {
        ...DEFAULT_SETTINGS.candidate,
        country: "United Kingdom",
      },
    };
    const euSettings = {
      ...DEFAULT_SETTINGS,
      startupRegion: "eu" as const,
      searchKeywords: "software engineer",
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
      searchKeywords: "software engineer",
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
      searchKeywords: "frontend engineer\nsoftware engineer",
      candidate: {
        ...DEFAULT_SETTINGS.candidate,
        country: "United States",
      },
    };

    const targets = buildOtherJobSiteTargets(settings);
    const urls = targets.map((target) => target.url);

    expect(urls).toContain(
      "https://builtin.com/jobs?search=frontend%20engineer"
    );
    expect(urls).toContain(
      "https://www.workatastartup.com/jobs?query=frontend%20engineer"
    );
    expect(urls).toContain(
      "https://www.workatastartup.com/jobs?query=software%20engineer"
    );
  });

  it("dedupes equivalent other-site keyword variants before building search targets", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      startupRegion: "us" as const,
      searchKeywords:
        "Software Engineer\n software engineer \nsoftware-engineer",
      candidate: {
        ...DEFAULT_SETTINGS.candidate,
        country: "United States",
      },
    };

    const targets = buildOtherJobSiteTargets(settings);
    const builtInTargets = targets.filter((target) =>
      target.url.startsWith("https://builtin.com/jobs?")
    );
    const workAtStartupTargets = targets.filter((target) =>
      target.url.startsWith("https://www.workatastartup.com/jobs?")
    );

    expect(builtInTargets).toHaveLength(1);
    expect(workAtStartupTargets).toHaveLength(1);
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

  it("detects Cloudflare verification pages used by ZipRecruiter", () => {
    document.title = "Just a moment...";
    document.body.innerHTML = `
      <main>
        <h1>Performing security verification</h1>
        <p>This website uses a security service to protect against malicious bots.</p>
        <p>Performance and Security by Cloudflare</p>
        <p>Ray ID: 9dedcdb5d9f3b4c6</p>
      </main>
    `;

    expect(isProbablyHumanVerificationPage(document)).toBe(true);
  });

  it("detects ZipRecruiter rate-limit pages from their block copy", () => {
    document.title = "Rate limit exceeded";
    document.body.innerHTML = `
      <main>
        <h1>Rate limit exceeded</h1>
        <p>Please try again later.</p>
        <p>If you'd like an XML feed containing an up-to-date list of jobs, please reach out to us at:</p>
      </main>
    `;

    expect(isProbablyRateLimitPage(document, "ziprecruiter")).toBe(true);
  });

  it("detects Monster unusual-activity restriction pages as rate limits", () => {
    document.title = "Unusual activity detected";
    document.body.innerHTML = `
      <main>
        <h1>We detected unusual activity from your device or network.</h1>
        <p>Automated (bot) activity on your network (IP 23.237.33.110)</p>
        <p>Rapid taps or clicks</p>
        <p>Need help? Submit feedback.</p>
        <p>ID: 7460a163-a6a2-8656-d0de-3dc67263769c</p>
      </main>
    `;

    expect(isProbablyRateLimitPage(document, "monster")).toBe(true);
  });

  it("detects sign-in gates without mistaking application forms for auth walls", () => {
    document.title = "Sign in to continue";
    document.body.innerHTML = `
      <main>
        <h1>Sign in to continue</h1>
        <input type="email" />
        <input type="password" />
        <button type="button">Continue with Google</button>
      </main>
    `;

    expect(isProbablyAuthGatePage(document)).toBe(true);

    document.title = "Apply";
    document.body.innerHTML = `
      <main>
        <h1>Submit Your Application</h1>
        <label>Email <input type="email" /></label>
        <label>Password hint <input type="text" /></label>
        <button type="button">Continue</button>
      </main>
    `;

    expect(isProbablyAuthGatePage(document)).toBe(false);
  });

  it("detects Dice-style apply login prompts as auth gates", () => {
    document.title = "Apply to job";
    document.body.innerHTML = `
      <section role="dialog" aria-modal="true">
        <h1>Apply to job</h1>
        <p>To apply to this job, you need to create an account or log in.</p>
        <button type="button">Cancel</button>
        <a href="/dashboard/login">Log in</a>
        <button type="button">Create an Account</button>
      </section>
    `;

    expect(isProbablyAuthGatePage(document)).toBe(true);
  });

  it("detects access-denied XML error pages and does not treat them as verification", () => {
    document.title = "";
    document.body.textContent = `
      This XML file does not appear to have any style information associated with it.
      <Error>
        <Code>AccessDenied</Code>
        <Message>Access Denied</Message>
        <RequestId>RG6XFK4GTHN1BE7K</RequestId>
        <HostId>WHORZALdomRXvwJjODTe2Nk6BJFUbyxH0FWyh9HDLyXgYnJs6ZOcjKoe3j/CIZAL+haTaPkT8hQ=</HostId>
      </Error>
    `;

    expect(detectBrokenPageReason(document)).toBe("access_denied");
    expect(isProbablyHumanVerificationPage(document)).toBe(false);
  });

  it("detects Cloudflare bad gateway pages and does not treat them as verification", () => {
    document.title = "Bad gateway";
    document.body.innerHTML = `
      <main>
        <h1>Bad gateway</h1>
        <p>The web server reported a bad gateway error.</p>
        <p>Ray ID: 9defd4c54af92b74</p>
        <p>Error reference number: 502</p>
        <p>Cloudflare Location: Los Angeles</p>
      </main>
    `;

    expect(detectBrokenPageReason(document)).toBe("bad_gateway");
    expect(isProbablyHumanVerificationPage(document)).toBe(false);
  });

  it("detects page-not-found error pages and does not treat them as verification", () => {
    window.history.replaceState({}, "", "/careers/page-not-found");
    document.title = "404 Page Not Found";
    document.body.innerHTML = `
      <main>
        <h1>Page Not Found</h1>
        <p>The page you were looking for does not exist.</p>
      </main>
    `;

    expect(detectBrokenPageReason(document)).toBe("not_found");
    expect(isProbablyHumanVerificationPage(document)).toBe(false);
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

  it("does not treat Indeed resume-selection steps with embedded captcha markers as verification", () => {
    window.history.replaceState(
      {},
      "",
      "/beta/indeedapply/form/resume-selection-module/resume-selection"
    );
    document.title = "Indeed Apply";
    document.body.innerHTML = `
      <main>
        <button type="button">Save and Close</button>
        <h1>Add a resume for the employer</h1>
        <p>Uploaded Mar 16, 2026</p>
        <button type="button">Resume options</button>
        <button type="button">Continue</button>
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
      searchKeywords: "software engineer\nfrontend engineer",
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
      preferenceAnswers: {
        " can you relocate ": {
          question: "Can you relocate?",
          value: "Yes",
          updatedAt: 789,
        },
      },
    });

    expect(settings.jobPageLimit).toBe(25);
    expect(settings.autoUploadResumes).toBe(false);
    expect(settings.searchMode).toBe("other_job_sites");
    expect(settings.startupRegion).toBe("uk");
    expect(settings.datePostedWindow).toBe("24h");
    expect(settings.searchKeywords).toBe("software engineer\nfrontend engineer");
    expect(settings.candidate.fullName).toBe("Ada Lovelace");
    expect(settings.candidate.email).toBe("ada@example.com");
    expect(settings.candidate.country).toBe("United Kingdom");
    expect(settings.resume?.name).toBe("resume.pdf");
    expect(settings.profiles[settings.activeProfileId]?.resume?.name).toBe("resume.pdf");
    expect(settings.answers[normalizeQuestionKey("Why do you want this role?")]?.value).toBe(
      "Impact and scope."
    );
    expect(
      settings.preferenceAnswers[normalizeQuestionKey("Can you relocate?")]?.value
    ).toBe("Yes");
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
