// Note: describe, expect, it are provided globally by vitest (globals: true)

import {
  findApplyAction,
  findCompanySiteAction,
  findDiceApplyAction,
  findGlassdoorApplyAction,
  findMonsterApplyAction,
  findProgressionAction,
  findZipRecruiterApplyAction,
  hasIndeedApplyIframe,
  hasZipRecruiterApplyModal,
  isAlreadyOnApplyPage,
  isSameOriginInternalApplyStepNavigation,
  isLikelyApplyUrl,
  shouldPreferApplyNavigation,
} from "../src/content/apply";

describe("application progression actions", () => {
  it("treats same-page Indeed review anchors as click actions", () => {
    window.history.replaceState({}, "", "/apply");
    document.body.innerHTML = `
      <form>
        <a href="#" data-testid="review-step-link">Review application</a>
      </form>
    `;

    const action = findProgressionAction("indeed");

    expect(action).not.toBeNull();
    expect(action?.type).toBe("click");
    expect(action?.text).toBe("Review application");
  });

  it("finds ZipRecruiter progression buttons after autofill", () => {
    document.body.innerHTML = `
      <form>
        <button type="button" data-testid="next-step">Next</button>
      </form>
    `;

    const action = findProgressionAction("ziprecruiter");

    expect(action).not.toBeNull();
    expect(action?.type).toBe("click");
    expect(action?.text).toBe("Next");
  });

  it("treats internal Indeed continuation form-actions as click progression", () => {
    window.history.replaceState(
      {},
      "",
      "/beta/indeedapply/form/demographic-questions-module/demographic-questions/1"
    );
    document.body.innerHTML = `
      <form>
        <button
          type="submit"
          formaction="/beta/indeedapply/form/review"
          data-testid="continue-button"
        >
          Continue
        </button>
      </form>
    `;

    const action = findProgressionAction("indeed");

    expect(action).not.toBeNull();
    expect(action?.type).toBe("click");
    expect(action?.text).toBe("Continue");
  });

  it("treats same-origin Indeed apply-step continuation controls as clicks even outside forms", () => {
    window.history.replaceState(
      {},
      "",
      "/beta/indeedapply/form/demographic-questions-module/demographic-questions/1"
    );
    document.body.innerHTML = `
      <section class="ia-ResumeStep">
        <button
          formaction="/beta/indeedapply/form/review"
          data-testid="continue-button"
        >
          Continue
        </button>
      </section>
    `;

    const action = findProgressionAction("indeed");

    expect(action).not.toBeNull();
    expect(action?.type).toBe("click");
    expect(action?.text).toBe("Continue");
  });

  it("keeps review-module follow-up controls click-based for internal Indeed steps", () => {
    window.history.replaceState(
      {},
      "",
      "/beta/indeedapply/form/review-module"
    );
    document.body.innerHTML = `
      <section class="ia-ReviewModule">
        <button
          formaction="/beta/indeedapply/form/submit"
          data-testid="continue-button"
        >
          Continue
        </button>
      </section>
    `;

    const action = findApplyAction("indeed", "follow-up");

    expect(action).not.toBeNull();
    expect(action?.type).toBe("click");
    expect(action?.description).toBe("Continue");
  });

  it("recognizes review-module to submit-step Indeed URLs as internal apply-step navigation", () => {
    window.history.replaceState(
      {},
      "",
      "/beta/indeedapply/form/review-module"
    );

    expect(
      isSameOriginInternalApplyStepNavigation(
        "/beta/indeedapply/form/submit"
      )
    ).toBe(true);
  });

  it("prefers application-context progression controls over header navigation", () => {
    document.body.innerHTML = `
      <header>
        <button>Continue</button>
      </header>
      <form>
        <button type="button" data-testid="next-step">Next</button>
      </form>
    `;

    const action = findProgressionAction("ziprecruiter");

    expect(action).not.toBeNull();
    expect(action?.text).toBe("Next");
  });

  it("ignores final submit buttons when looking for progression", () => {
    document.body.innerHTML = `
      <form>
        <button type="submit">Submit application</button>
      </form>
    `;

    expect(findProgressionAction("indeed")).toBeNull();
  });

  it("finds external company-site continuation links", () => {
    document.body.innerHTML = `
      <section>
        <p>You will be redirected to the company website to apply.</p>
        <a href="https://company.example.com/careers/apply">Apply on company site</a>
      </section>
    `;

    const action = findCompanySiteAction();

    expect(action).not.toBeNull();
    expect(action?.type).toBe("navigate");
    if (action?.type === "navigate") {
      expect(action.url).toBe("https://company.example.com/careers/apply");
    }
  });

  it("prefers explicit company-site links over unrelated ATS URLs buried in inline scripts", () => {
    document.body.innerHTML = `
      <script type="application/json">
        {
          "trackingUrl": "https://jobs.workday.com/older-role/apply"
        }
      </script>
      <section>
        <p>You will be redirected to the company website to apply.</p>
        <a href="https://company.example.com/careers/current-role/apply">Apply on company site</a>
      </section>
    `;

    const action = findCompanySiteAction();

    expect(action).not.toBeNull();
    expect(action?.type).toBe("navigate");
    if (action?.type === "navigate") {
      expect(action.url).toBe(
        "https://company.example.com/careers/current-role/apply"
      );
    }
  });

  it("does not navigate directly to same-site Indeed company-site gateways when a real external apply URL is discoverable", () => {
    window.history.replaceState({}, "", "/viewjob?jk=abc123");
    document.body.innerHTML = `
      <section>
        <p>You will be redirected to the company website to apply.</p>
        <a href="/orgIndApp?jobKey=abc123">Apply on company site</a>
      </section>
      <script type="application/json">
        {
          "applyUrl": "https://jobs.workday.com/example/job/software-engineer/apply"
        }
      </script>
    `;

    const action = findCompanySiteAction();

    expect(action).not.toBeNull();
    expect(action?.type).toBe("navigate");
    if (action?.type === "navigate") {
      expect(action.url).toBe(
        "https://jobs.workday.com/example/job/software-engineer/apply"
      );
    }
  });

  it("treats internal Indeed conversation gateways as broken direct-navigation targets", () => {
    window.history.replaceState({}, "", "/viewjob?jk=abc123");
    document.body.innerHTML = `
      <section>
        <p>You will be redirected to the company website to apply.</p>
        <a href="https://gdc.indeed.com/conv/orgIndApp?c=US&vjk=abc123">Apply on company site</a>
      </section>
      <script type="application/json">
        {
          "applyUrl": "https://jobs.workday.com/example/job/software-engineer/apply"
        }
      </script>
    `;

    const action = findCompanySiteAction();

    expect(action).not.toBeNull();
    expect(action?.type).toBe("navigate");
    if (action?.type === "navigate") {
      expect(action.url).toBe(
        "https://jobs.workday.com/example/job/software-engineer/apply"
      );
    }
  });

  it("ignores ATS image assets when discovering external company-site apply URLs", () => {
    document.body.innerHTML = `
      <main>
        <button type="button">Apply on company site</button>
        <script type="application/json">
          {
            "logo": "https://jobs.workday.com/example/assets/company-logo.png",
            "applyUrl": "https://jobs.workday.com/example/job/platform-engineer/apply"
          }
        </script>
      </main>
    `;

    const action = findCompanySiteAction();

    expect(action).not.toBeNull();
    expect(action?.type).toBe("navigate");
    if (action?.type === "navigate") {
      expect(action.url).toBe(
        "https://jobs.workday.com/example/job/platform-engineer/apply"
      );
    }
  });

  it("prefers a direct apply button over a company-site CTA on generic job pages", () => {
    document.body.innerHTML = `
      <section>
        <button type="button">Apply Now</button>
        <a href="https://company.example.com/careers/apply">Apply on company site</a>
      </section>
    `;

    const action = findApplyAction("other_sites", "job-page");

    expect(action).not.toBeNull();
    expect(action?.type).toBe("click");
    expect(action?.description).toBe("Apply Now");
  });

  it("ignores Indeed support article links on demographic apply steps", () => {
    window.history.replaceState(
      {},
      "",
      "/beta/indeedapply/form/demographic-questions-module/demographic-questions/1"
    );
    document.body.innerHTML = `
      <main>
        <p>Learn more about demographic questions during the application process.</p>
        <a href="https://support.indeed.com/hc/en-us/articles/360059972312-Why-Is-Indeed-Collecting-Demographic-Data-From-Job-Seekers">
          Why Is Indeed Collecting Demographic Data From Job Seekers?
        </a>
      </main>
    `;

    expect(findCompanySiteAction()).toBeNull();
    expect(findApplyAction("indeed", "job-page")).toBeNull();
  });

  it("ignores legal or terms links even when their URLs look like Indeed tracking links", () => {
    document.body.innerHTML = `
      <main>
        <a href="https://www.indeed.com/pagead/clk?jk=alpha123&url=https%3A%2F%2Fwww.indeed.com%2Flegal">
          Terms of Service
        </a>
      </main>
    `;

    expect(findApplyAction("indeed", "job-page")).toBeNull();
  });

  it("finds plain Indeed apply buttons on job pages", () => {
    document.body.innerHTML = `
      <main>
        <section class="jobsearch-IndeedApplyButton">
          <button type="button" data-testid="indeed-apply-button">
            Apply now
          </button>
        </section>
      </main>
    `;

    const action = findApplyAction("indeed", "job-page");

    expect(action).not.toBeNull();
    expect(action?.type).toBe("click");
    expect(action?.description).toBe("Apply now");
  });

  it("ignores combined legal-policy links on final Indeed review pages", () => {
    document.body.innerHTML = `
      <main>
        <a href="https://www.indeed.com/legal">
          Terms, Cookie & Privacy Policies
        </a>
      </main>
    `;

    expect(findCompanySiteAction()).toBeNull();
    expect(findApplyAction("indeed", "follow-up")).toBeNull();
  });

  it("ignores company-site actions that already point to not-found or error pages", () => {
    document.body.innerHTML = `
      <section>
        <p>You will be redirected to the company website to apply.</p>
        <a href="https://company.example.com/careers/page-not-found">Apply on company site</a>
      </section>
    `;

    expect(findCompanySiteAction()).toBeNull();
  });

  it("extracts Monster apply URLs from custom web components", () => {
    document.body.innerHTML = `
      <apply-button-wc
        id="monster-apply"
        data-apply-url="https://company.example.com/careers/apply"
      ></apply-button-wc>
    `;

    const action = findMonsterApplyAction();

    expect(action).not.toBeNull();
    expect(action?.type).toBe("click");
    expect(action?.description).toBe("Monster apply button");
  });

  it("falls back to markup-only apply URLs on generic career pages", () => {
    document.body.innerHTML = `
      <main>
        <button type="button">Apply on company site</button>
        <script>
          window.__APPLY_TARGET__ = "https://boards.greenhouse.io/example/jobs/12345";
        </script>
      </main>
    `;

    const action = findCompanySiteAction();

    expect(action).not.toBeNull();
    expect(action?.type).toBe("navigate");
    if (action?.type === "navigate") {
      expect(action.url).toBe("https://boards.greenhouse.io/example/jobs/12345");
    }
  });

  it("uses Monster shadow-dom apply controls when present", () => {
    const component = document.createElement("apply-button-wc");
    const shadow = component.attachShadow({ mode: "open" });
    shadow.innerHTML = `<a href="https://company.example.com/job/apply">Apply now</a>`;
    document.body.appendChild(component);

    const action = findMonsterApplyAction();

    expect(action).not.toBeNull();
    expect(action?.type).toBe("click");
    expect(action?.description).toBe("Apply now");
    if (action?.type === "click") {
      expect(action.element).toBe(shadow.querySelector("a"));
      expect(action.fallbackElements).toContain(component);
    }
  });

  it("ignores broken apply.monster URLs and uses the real Monster apply target", () => {
    const component = document.createElement("apply-button-wc");
    component.setAttribute("data-apply-url", "https://apply.monster.com/job-apply/abc");
    const shadow = component.attachShadow({ mode: "open" });
    shadow.innerHTML = `<a href="https://company.example.com/careers/apply/123">Apply now</a>`;
    document.body.appendChild(component);

    const action = findMonsterApplyAction();

    expect(action).not.toBeNull();
    expect(action?.type).toBe("click");
    expect(action?.description).toBe("Apply now");
  });

  it("ignores Monster filter controls and prefers the real apply action", () => {
    document.body.innerHTML = `
      <header>
        <button aria-label="Apply filters">Apply filters</button>
      </header>
      <main>
        <button data-testid="svx_applyButton">Apply Now</button>
      </main>
    `;

    const action = findMonsterApplyAction();

    expect(action).not.toBeNull();
    expect(action?.type).toBe("click");
    expect(action?.description).toBe("Apply Now");
  });

  it("prefers Monster apply actions inside the current job surface over sidebar actions", () => {
    document.body.innerHTML = `
      <aside>
        <button data-testid="svx_applyButton">Apply to recommended job</button>
      </aside>
      <main class="job-detail-panel">
        <section class="job-description">
          <button data-testid="svx_applyButton">Apply Now</button>
        </section>
      </main>
    `;

    const action = findMonsterApplyAction();

    expect(action).not.toBeNull();
    expect(action?.type).toBe("click");
    expect(action?.description).toBe("Apply Now");
  });

  it("finds plain Monster quick-apply buttons on the current job surface", () => {
    document.body.innerHTML = `
      <main class="job-detail-panel">
        <a href="/jobs">Back to Results</a>
        <section class="job-description">
          <header>
            <h1>Senior DevOps Engineer</h1>
            <button type="button">Quick Apply</button>
          </header>
          <p>Remote USA</p>
        </section>
      </main>
    `;

    const action = findMonsterApplyAction();

    expect(action).not.toBeNull();
    expect(action?.type).toBe("click");
    expect(action?.description).toBe("Quick Apply");
  });

  it("prefers the top-most Monster quick-apply button on apply-button style pages", () => {
    document.body.innerHTML = `
      <main class="job-detail-panel">
        <section class="job-description">
          <header>
            <button id="top-quick-apply" type="button">Quick Apply</button>
          </header>
          <div class="job-body">
            <button id="lower-quick-apply" type="button">Quick Apply</button>
          </div>
        </section>
      </main>
    `;

    const topButton = document.querySelector("#top-quick-apply") as HTMLButtonElement;
    const lowerButton = document.querySelector(
      "#lower-quick-apply"
    ) as HTMLButtonElement;

    Object.defineProperty(topButton, "getBoundingClientRect", {
      configurable: true,
      value: () =>
        ({
          top: 80,
          left: 0,
          width: 120,
          height: 40,
          right: 120,
          bottom: 120,
          x: 0,
          y: 80,
          toJSON: () => ({}),
        }) as DOMRect,
    });
    Object.defineProperty(lowerButton, "getBoundingClientRect", {
      configurable: true,
      value: () =>
        ({
          top: 520,
          left: 0,
          width: 120,
          height: 40,
          right: 120,
          bottom: 560,
          x: 0,
          y: 520,
          toJSON: () => ({}),
        }) as DOMRect,
    });

    const action = findMonsterApplyAction();

    expect(action).not.toBeNull();
    expect(action?.type).toBe("click");
    if (action?.type === "click") {
      expect(action.element).toBe(topButton);
    }
  });

  it("prefers the top-most Monster apply button when related-job apply cards are below it", () => {
    document.body.innerHTML = `
      <main class="job-detail-panel">
        <section class="job-description">
          <header>
            <button id="top-apply" type="button">Apply</button>
          </header>
        </section>
        <section class="related-jobs">
          <article>
            <button id="lower-apply-one" type="button">Apply</button>
          </article>
          <article>
            <button id="lower-apply-two" type="button">Apply</button>
          </article>
        </section>
      </main>
    `;

    const topButton = document.querySelector("#top-apply") as HTMLButtonElement;
    const lowerButtonOne = document.querySelector("#lower-apply-one") as HTMLButtonElement;
    const lowerButtonTwo = document.querySelector("#lower-apply-two") as HTMLButtonElement;

    Object.defineProperty(topButton, "getBoundingClientRect", {
      configurable: true,
      value: () =>
        ({
          top: 90,
          left: 0,
          width: 120,
          height: 40,
          right: 120,
          bottom: 130,
          x: 0,
          y: 90,
          toJSON: () => ({}),
        }) as DOMRect,
    });
    Object.defineProperty(lowerButtonOne, "getBoundingClientRect", {
      configurable: true,
      value: () =>
        ({
          top: 460,
          left: 0,
          width: 120,
          height: 40,
          right: 120,
          bottom: 500,
          x: 0,
          y: 460,
          toJSON: () => ({}),
        }) as DOMRect,
    });
    Object.defineProperty(lowerButtonTwo, "getBoundingClientRect", {
      configurable: true,
      value: () =>
        ({
          top: 720,
          left: 0,
          width: 120,
          height: 40,
          right: 120,
          bottom: 760,
          x: 0,
          y: 720,
          toJSON: () => ({}),
        }) as DOMRect,
    });

    const action = findMonsterApplyAction();

    expect(action).not.toBeNull();
    expect(action?.type).toBe("click");
    if (action?.type === "click") {
      expect(action.element).toBe(topButton);
    }
    expect(action?.description).toBe("Apply");
  });

  it("still prefers the top-most Monster apply CTA when the label includes icon text", () => {
    document.body.innerHTML = `
      <main class="job-detail-panel">
        <section class="job-description">
          <header>
            <button id="top-apply" type="button">↗ Apply</button>
          </header>
        </section>
        <section class="recommended-jobs">
          <article>
            <button id="lower-apply-one" type="button">Apply</button>
          </article>
        </section>
      </main>
    `;

    const topButton = document.querySelector("#top-apply") as HTMLButtonElement;
    const lowerButton = document.querySelector("#lower-apply-one") as HTMLButtonElement;

    Object.defineProperty(topButton, "getBoundingClientRect", {
      configurable: true,
      value: () =>
        ({
          top: 88,
          left: 0,
          width: 120,
          height: 40,
          right: 120,
          bottom: 128,
          x: 0,
          y: 88,
          toJSON: () => ({}),
        }) as DOMRect,
    });
    Object.defineProperty(lowerButton, "getBoundingClientRect", {
      configurable: true,
      value: () =>
        ({
          top: 460,
          left: 0,
          width: 120,
          height: 40,
          right: 120,
          bottom: 500,
          x: 0,
          y: 460,
          toJSON: () => ({}),
        }) as DOMRect,
    });

    const action = findMonsterApplyAction();

    expect(action).not.toBeNull();
    expect(action?.type).toBe("click");
    if (action?.type === "click") {
      expect(action.element).toBe(topButton);
    }
  });

  it("ignores Monster similar-jobs and resume-resources apply buttons under the main job", () => {
    document.body.innerHTML = `
      <main class="job-detail-panel">
        <section class="job-description">
          <header>
            <button id="top-apply" type="button">Apply now</button>
          </header>
        </section>
        <section class="resume-resources">
          <h2>Resume Resources</h2>
          <button id="resume-resource-apply" type="button">Apply</button>
        </section>
        <section class="similar-jobs">
          <h2>Similar Jobs</h2>
          <article>
            <button id="similar-job-apply" type="button">Apply</button>
          </article>
        </section>
      </main>
    `;

    const topButton = document.querySelector("#top-apply") as HTMLButtonElement;
    const resumeButton = document.querySelector(
      "#resume-resource-apply"
    ) as HTMLButtonElement;
    const similarButton = document.querySelector(
      "#similar-job-apply"
    ) as HTMLButtonElement;

    Object.defineProperty(topButton, "getBoundingClientRect", {
      configurable: true,
      value: () =>
        ({
          top: 72,
          left: 0,
          width: 120,
          height: 40,
          right: 120,
          bottom: 112,
          x: 0,
          y: 72,
          toJSON: () => ({}),
        }) as DOMRect,
    });
    Object.defineProperty(resumeButton, "getBoundingClientRect", {
      configurable: true,
      value: () =>
        ({
          top: 840,
          left: 0,
          width: 120,
          height: 40,
          right: 120,
          bottom: 880,
          x: 0,
          y: 840,
          toJSON: () => ({}),
        }) as DOMRect,
    });
    Object.defineProperty(similarButton, "getBoundingClientRect", {
      configurable: true,
      value: () =>
        ({
          top: 980,
          left: 0,
          width: 120,
          height: 40,
          right: 120,
          bottom: 1020,
          x: 0,
          y: 980,
          toJSON: () => ({}),
        }) as DOMRect,
    });

    const action = findMonsterApplyAction();

    expect(action).not.toBeNull();
    expect(action?.type).toBe("click");
    if (action?.type === "click") {
      expect(action.element).toBe(topButton);
    }
  });

  it("keeps same-site Monster apply targets click-based so site scripts can continue the flow", () => {
    document.body.innerHTML = `
      <main class="job-detail-panel">
        <section class="job-description">
          <apply-button-wc
            data-apply-url="https://www.monster.com/job-openings/frontend-engineer-remote--alpha123/apply"
            aria-label="Apply now"
          ></apply-button-wc>
        </section>
      </main>
    `;

    const action = findMonsterApplyAction();

    expect(action).not.toBeNull();
    expect(action?.type).toBe("click");
    expect(action?.description).toBe("Apply now");
  });

  it("keeps external Monster apply targets click-based so Monster can own the handoff", () => {
    document.body.innerHTML = `
      <main class="job-detail-panel">
        <section class="job-description">
          <apply-button-wc
            data-apply-url="https://company.example.com/careers/apply/123"
            aria-label="Apply now"
          ></apply-button-wc>
        </section>
      </main>
    `;

    const action = findMonsterApplyAction();

    expect(action).not.toBeNull();
    expect(action?.type).toBe("click");
    expect(action?.description).toBe("Apply now");
  });

  it("falls back to clicking a Monster component when only a broken apply URL is exposed", () => {
    document.body.innerHTML = `
      <apply-button-wc
        data-apply-url="https://apply.monster.com/job-apply/abc"
        aria-label="Apply now"
      ></apply-button-wc>
    `;

    const action = findMonsterApplyAction();

    expect(action).not.toBeNull();
    expect(action?.type).toBe("click");
    expect(action?.description).toBe("Apply now");
  });

  it("finds ZipRecruiter apply links that navigate directly to zipapply", () => {
    document.body.innerHTML = `
      <a href="https://www.ziprecruiter.com/job/apply/abc?zipapply=true">1-Click Apply</a>
    `;

    const action = findZipRecruiterApplyAction();

    expect(action).not.toBeNull();
    expect(action?.type).toBe("navigate");
    if (action?.type === "navigate") {
      expect(action.url).toContain("ziprecruiter.com/job/apply/abc");
    }
  });

  it("does not mistake ZipRecruiter direct-apply links for company-site handoffs", () => {
    document.body.innerHTML = `
      <a href="https://www.ziprecruiter.com/job/apply/abc?zipapply=true">Apply on company site</a>
    `;

    const action = findZipRecruiterApplyAction();

    expect(action).not.toBeNull();
    expect(action?.type).toBe("navigate");
    if (action?.type === "navigate") {
      expect(action.url).toBe("https://www.ziprecruiter.com/job/apply/abc?zipapply=true");
      expect(action.description).toBe("the apply page");
    }
  });

  it("finds ZipRecruiter company-site actions from generic apply controls", () => {
    document.body.innerHTML = `
      <button
        data-testid="company-apply-button"
        data-to="https://company.example.com/careers/apply/123"
        aria-label="Apply on company site"
      >
        Continue to company site
      </button>
    `;

    const action = findZipRecruiterApplyAction();

    expect(action).not.toBeNull();
    expect(action?.type).toBe("navigate");
    if (action?.type === "navigate") {
      expect(action.url).toBe("https://company.example.com/careers/apply/123");
    }
  });

  it("prefers ZipRecruiter direct apply buttons over company-site CTAs when both are present", () => {
    document.body.innerHTML = `
      <button data-testid="apply-button">Apply Now</button>
      <button
        data-testid="company-apply-button"
        data-to="https://company.example.com/careers/apply/123"
        aria-label="Apply on company site"
      >
        Continue to company site
      </button>
    `;

    const action = findZipRecruiterApplyAction();

    expect(action).not.toBeNull();
    expect(action?.type).toBe("click");
    expect(action?.description).toBe("Apply Now");
  });

  it("finds plain ZipRecruiter apply buttons on the current job surface", () => {
    document.body.innerHTML = `
      <main class="jobDetails">
        <section class="jobDescription">
          <header>
            <button type="button">Apply</button>
          </header>
        </section>
      </main>
    `;

    const action = findZipRecruiterApplyAction();

    expect(action).not.toBeNull();
    expect(action?.type).toBe("click");
    expect(action?.description).toBe("Apply");
  });

  it("prefers the top-most ZipRecruiter apply button when lower apply buttons exist", () => {
    document.body.innerHTML = `
      <main class="jobDetails">
        <section class="jobDescription">
          <header>
            <button id="top-zr-apply" type="button">Apply</button>
          </header>
          <div class="recommendedJobs">
            <button id="lower-zr-apply" type="button">Apply</button>
          </div>
        </section>
      </main>
    `;

    const topButton = document.querySelector("#top-zr-apply") as HTMLButtonElement;
    const lowerButton = document.querySelector("#lower-zr-apply") as HTMLButtonElement;

    Object.defineProperty(topButton, "getBoundingClientRect", {
      configurable: true,
      value: () =>
        ({
          top: 82,
          left: 0,
          width: 120,
          height: 40,
          right: 120,
          bottom: 122,
          x: 0,
          y: 82,
          toJSON: () => ({}),
        }) as DOMRect,
    });
    Object.defineProperty(lowerButton, "getBoundingClientRect", {
      configurable: true,
      value: () =>
        ({
          top: 520,
          left: 0,
          width: 120,
          height: 40,
          right: 120,
          bottom: 560,
          x: 0,
          y: 520,
          toJSON: () => ({}),
        }) as DOMRect,
    });

    const action = findZipRecruiterApplyAction();

    expect(action).not.toBeNull();
    expect(action?.type).toBe("click");
    if (action?.type === "click") {
      expect(action.element).toBe(topButton);
    }
  });

  it("does not treat a ZipRecruiter company-name link as the apply action", () => {
    document.body.innerHTML = `
      <a class="company-name" href="https://company.example.com">Acme Corp</a>
      <a href="https://www.ziprecruiter.com/job/apply/abc?zipapply=true">1-Click Apply</a>
    `;

    const action = findZipRecruiterApplyAction();

    expect(action).not.toBeNull();
    expect(action?.type).toBe("navigate");
    if (action?.type === "navigate") {
      expect(action.url).toContain("ziprecruiter.com/job/apply/abc");
    }
  });

  it("only treats explicit ZipRecruiter company-apply controls as company-site apply actions", () => {
    document.body.innerHTML = `
      <a class="company-name" href="https://company.example.com">Acme Corp</a>
    `;

    const action = findZipRecruiterApplyAction();

    expect(action).toBeNull();
  });

  it("ignores ZipRecruiter candidate-portal links like My Jobs and prefers the real apply action", () => {
    document.body.innerHTML = `
      <a href="https://www.ziprecruiter.com/candidate/my-jobs">My Jobs</a>
      <button
        data-testid="company-apply-button"
        data-to="https://company.example.com/careers/apply/123"
      >
        Continue to company site
      </button>
    `;

    const action = findZipRecruiterApplyAction();

    expect(action).not.toBeNull();
    expect(action?.type).toBe("navigate");
    if (action?.type === "navigate") {
      expect(action.url).toBe("https://company.example.com/careers/apply/123");
    }
  });

  it("unwraps ZipRecruiter redirect links to the real company-site destination", () => {
    document.body.innerHTML = `
      <a href="https://www.ziprecruiter.com/jobs/redirect?url=https%3A%2F%2Fcompany.example.com%2Fcareers%2Fapply">
        Apply on company site
      </a>
    `;

    const action = findZipRecruiterApplyAction();

    expect(action).not.toBeNull();
    expect(action?.type).toBe("navigate");
    if (action?.type === "navigate") {
      expect(action.url).toBe("https://company.example.com/careers/apply");
    }
  });

  it("finds ZipRecruiter apply actions rendered inside shadow DOM", () => {
    const host = document.createElement("zip-apply-button");
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <button data-testid="apply-button">Apply Now</button>
    `;
    document.body.appendChild(host);

    const action = findZipRecruiterApplyAction();

    expect(action).not.toBeNull();
    expect(action?.type).toBe("click");
    expect(action?.description).toBe("Apply Now");
  });

  it("finds ZipRecruiter apply buttons from job-detail surfaces even when text is only exposed by aria-label metadata", () => {
    document.body.innerHTML = `
      <main class="jobDetailsPanel">
        <button
          data-testid="apply-button"
          aria-label="Apply Now"
        ></button>
      </main>
      <aside>
        <button data-testid="apply-button">Save job</button>
      </aside>
    `;

    const action = findZipRecruiterApplyAction();

    expect(action).not.toBeNull();
    expect(action?.type).toBe("click");
    expect(action?.description).toBe("Apply Now");
  });

  it("does not treat ZipRecruiter applied-state buttons as apply actions", () => {
    document.body.innerHTML = `
      <main data-testid="job-details">
        <button data-testid="apply-button" aria-label="Applied">Applied</button>
      </main>
    `;

    const action = findZipRecruiterApplyAction();

    expect(action).toBeNull();
  });

  it("finds Glassdoor employer-site apply links", () => {
    document.body.innerHTML = `
      <main>
        <a
          data-test="apply-button"
          href="https://company.example.com/careers/apply/123"
        >
          Apply on employer site
        </a>
      </main>
    `;

    const action = findGlassdoorApplyAction();

    expect(action).not.toBeNull();
    expect(action?.type).toBe("navigate");
    if (action?.type === "navigate") {
      expect(action.url).toBe("https://company.example.com/careers/apply/123");
    }
  });

  it("finds Glassdoor easy-apply buttons that stay on the page", () => {
    document.body.innerHTML = `
      <main>
        <button data-test="easy-apply-button">Easy Apply</button>
      </main>
    `;

    const action = findGlassdoorApplyAction();

    expect(action).not.toBeNull();
    expect(action?.type).toBe("click");
    expect(action?.description).toBe("Easy Apply");
  });

  it("treats Glassdoor modal start buttons as progression actions", () => {
    document.body.innerHTML = `
      <section role="dialog" aria-modal="true">
        <p>You're on your way to apply.</p>
        <button data-test="start-application">Start My Application</button>
      </section>
    `;

    const action = findProgressionAction("glassdoor");

    expect(action).not.toBeNull();
    expect(action?.type).toBe("click");
    expect(action?.text).toBe("Start My Application");
  });

  it("uses aria-label metadata for icon-like progression controls", () => {
    document.body.innerHTML = `
      <section role="dialog" aria-modal="true">
        <button aria-label="Continue application"></button>
      </section>
    `;

    const action = findProgressionAction("glassdoor");

    expect(action).not.toBeNull();
    expect(action?.text).toBe("Continue application");
  });

  it("detects Glassdoor upload-step progression controls from data-test metadata", () => {
    document.body.innerHTML = `
      <section role="dialog" aria-modal="true">
        <div>Upload your resume and continue your application</div>
        <button data-test="continue-button"></button>
      </section>
    `;

    const action = findProgressionAction("glassdoor");

    expect(action).not.toBeNull();
    expect(action?.type).toBe("click");
  });

  it("detects ZipRecruiter apply modals rendered inside shadow DOM", () => {
    const host = document.createElement("zip-modal-host");
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <section role="dialog">
        <div>Upload your resume and continue your application</div>
        <input type="text" />
      </section>
    `;
    document.body.appendChild(host);

    expect(hasZipRecruiterApplyModal()).toBe(true);
  });

  it("finds Dice apply buttons exposed through data-testid selectors", () => {
    document.body.innerHTML = `
      <button data-testid="apply-button">Apply Now</button>
    `;

    const action = findApplyAction("dice", "job-page");

    expect(action).not.toBeNull();
    expect(action?.type).toBe("click");
    expect(action?.description).toBe("Apply Now");
  });

  it("finds plain Dice quick-apply buttons on the current job detail surface", () => {
    document.body.innerHTML = `
      <main class="job-details-pane">
        <a href="/jobs" class="back-link">Back to Results</a>
        <section class="job-description">
          <header>
            <h1>Senior DevOps Engineer</h1>
            <button type="button">Quick Apply</button>
          </header>
          <p>Remote USA</p>
        </section>
      </main>
    `;

    const action = findApplyAction("dice", "job-page");

    expect(action).not.toBeNull();
    expect(action?.type).toBe("click");
    expect(action?.description).toBe("Quick Apply");
  });

  it("prefers Dice inline start-apply routes when the page embeds them", () => {
    document.body.innerHTML = `
      <script>
        window.__DICE_JOB__ = {
          startApplyUrl: "/job-applications/d32a5e6b-4beb-4314-9830-a5b0c943d59c/start-apply"
        };
      </script>
      <button data-testid="apply-button">Apply Now</button>
    `;

    const action = findDiceApplyAction();

    expect(action).not.toBeNull();
    expect(action?.type).toBe("navigate");
    if (action?.type === "navigate") {
      expect(action.url).toBe(
        `${window.location.origin}/job-applications/d32a5e6b-4beb-4314-9830-a5b0c943d59c/start-apply`
      );
    }
  });

  it("ignores Dice apply controls that only belong to nested result cards", () => {
    document.body.innerHTML = `
      <main class="job-details-pane">
        <section class="job-description">
          <h1>Senior Platform Engineer</h1>
          <button data-testid="apply-button">Apply for this job</button>
        </section>
        <section aria-label="Job search results">
          <article>
            <a
              data-testid="job-search-job-detail-link"
              href="https://www.dice.com/job-detail/another-role"
            >
              Another Role
            </a>
            <button data-testid="apply-button">Apply to similar job</button>
          </article>
        </section>
      </main>
    `;

    const action = findDiceApplyAction();

    expect(action).not.toBeNull();
    expect(action?.type).toBe("click");
    expect(action?.description).toBe("Apply for this job");
  });

  it("ignores Dice nested-result shadow apply controls and keeps the current job action", () => {
    document.body.innerHTML = `
      <main class="job-details-pane">
        <section class="job-description">
          <h1>Senior Platform Engineer</h1>
          <div id="detail-host"></div>
        </section>
        <section aria-label="Job search results">
          <dhi-search-card id="nested-card"></dhi-search-card>
        </section>
      </main>
    `;

    const detailHost = document.querySelector("#detail-host") as HTMLElement;
    const detailShadow = detailHost.attachShadow({ mode: "open" });
    detailShadow.innerHTML = `
      <button data-testid="apply-button">Apply for this job</button>
    `;

    const nestedCard = document.querySelector("#nested-card") as HTMLElement;
    const nestedShadow = nestedCard.attachShadow({ mode: "open" });
    nestedShadow.innerHTML = `
      <button data-testid="apply-button">Apply to similar job</button>
    `;

    const action = findDiceApplyAction();

    expect(action).not.toBeNull();
    expect(action?.type).toBe("click");
    expect(action?.description).toBe("Apply for this job");
  });

  it("finds Dice progression buttons even when utility classes make the raw metadata very long", () => {
    document.body.innerHTML = `
      <section role="dialog" aria-modal="true">
        <div>Continue your Dice application</div>
        <button
          data-testid="continue-button"
          class="outline-offset-2 outline-stroke-focus forced-colors:outline-[Highlight] relative inline-flex items-center justify-center self-center rounded-full p-[11px] align-middle font-medium [&_span:first-of-type_svg]:block border border-interaction bg-interaction text-white hover:border-interaction-hover hover:bg-interaction-hover pressed:border-interaction-active pressed:bg-interaction-active px-[23px] py-[7px] text-sm [&_span:first-of-type_svg]:h-5 [&_span:first-of-type_svg]:w-5 outline-0 min-h-9 min-w-[126px] w-full"
        >
          Continue
        </button>
      </section>
    `;

    const action = findProgressionAction("dice");

    expect(action).not.toBeNull();
    expect(action?.type).toBe("click");
    expect(action?.text).toBe("Continue");
  });

  it("prefers external apply links on generic career sites", () => {
    document.body.innerHTML = `
      <section>
        <a href="https://boards.greenhouse.io/embed/job_app?for=example&token=abc123">Apply now</a>
        <button>Save</button>
      </section>
    `;

    const action = findApplyAction("other_sites", "job-page");

    expect(action).not.toBeNull();
    expect(action?.type).toBe("navigate");
    if (action?.type === "navigate") {
      expect(action.url).toBe("https://boards.greenhouse.io/embed/job_app?for=example&token=abc123");
    }
  });

  it("keeps internal follow-up apply actions click-based inside application forms", () => {
    window.history.replaceState(
      {},
      "",
      "/beta/indeedapply/form/demographic-questions-module/demographic-questions/1"
    );
    document.body.innerHTML = `
      <form>
        <button
          type="submit"
          formaction="/beta/indeedapply/form/review"
        >
          Continue application
        </button>
      </form>
    `;

    const action = findApplyAction("indeed", "follow-up");

    expect(action).not.toBeNull();
    expect(action?.type).toBe("click");
    expect(action?.description).toBe("Continue application");
  });

  it("finds same-page Greenhouse apply anchors on generic career sites", () => {
    document.body.innerHTML = `
      <section>
        <a href="#application">Apply for this job</a>
        <div id="application"></div>
      </section>
    `;

    const action = findApplyAction("other_sites", "job-page");

    expect(action).not.toBeNull();
    expect(action?.type).toBe("click");
    expect(action?.description).toBe("Apply for this job");
  });

  it("detects embedded Indeed and ZipRecruiter application surfaces", () => {
    document.body.innerHTML = `
      <iframe src="https://smartapply.indeed.com/apply/start"></iframe>
      <div role="dialog">
        <div>Apply with your resume</div>
        <input type="text" />
      </div>
      <section aria-modal="true">
        <div>Upload your resume and continue your application</div>
        <button>Continue</button>
      </section>
    `;

    expect(hasIndeedApplyIframe()).toBe(true);
    expect(hasZipRecruiterApplyModal()).toBe(true);
  });

  it("recognizes direct application URLs and navigation preference", () => {
    expect(
      isLikelyApplyUrl(
        "https://boards.greenhouse.io/embed/job_app?for=example&token=abc123",
        "other_sites"
      )
    ).toBe(true);
    expect(
      isLikelyApplyUrl(
        "https://job-boards.greenhouse.io/example/jobs/1234567/apply",
        "other_sites"
      )
    ).toBe(true);
    expect(
      isLikelyApplyUrl(
        "https://job-boards.greenhouse.io/example/jobs/1234567?gh_jid=1234567",
        "other_sites"
      )
    ).toBe(false);
    expect(
      isLikelyApplyUrl(
        "https://www.dice.com/job-applications/d32a5e6b-4beb-4314-9830-a5b0c943d59c/start-apply",
        "dice"
      )
    ).toBe(true);
    expect(isLikelyApplyUrl("https://example.com/jobs/123", "other_sites")).toBe(false);
    expect(isAlreadyOnApplyPage("startup", "https://jobs.example.com/apply/123")).toBe(true);
    expect(
      shouldPreferApplyNavigation(
        "https://company.example.com/careers/apply",
        "Apply on company site",
        "monster"
      )
    ).toBe(true);
    expect(
      shouldPreferApplyNavigation(
        "https://apply.monster.com/job-apply/abc",
        "Apply now",
        "monster"
      )
    ).toBe(false);
    expect(shouldPreferApplyNavigation("https://example.com/jobs/123", "Apply", "other_sites")).toBe(
      false
    );
  });

  it("prefers Built In's real external apply link over sticky helper buttons", () => {
    document.body.innerHTML = `
      <main>
        <a
          href="https://jobs.ashbyhq.com/example/6462d3d1-443c-4a5a-8667-c1d0472fa32d"
          aria-label="Apply to job"
          class="job-post-sticky-bar-btn"
        >
          APPLY
        </a>
        <button id="filter-apply-handler">Apply</button>
      </main>
    `;

    const action = findApplyAction("other_sites", "job-page");

    expect(action).not.toBeNull();
    expect(action?.type).toBe("navigate");
    if (action?.type === "navigate") {
      expect(action.url).toBe(
        "https://jobs.ashbyhq.com/example/6462d3d1-443c-4a5a-8667-c1d0472fa32d"
      );
    }
  });

  it("prefers Built In external apply actions when running on the Built In site profile", () => {
    document.body.innerHTML = `
      <main class="job-post">
        <a
          href="https://jobs.ashbyhq.com/example/6462d3d1-443c-4a5a-8667-c1d0472fa32d"
          aria-label="Apply to job"
          class="job-post-sticky-bar-btn"
        >
          APPLY
        </a>
        <button id="filter-apply-handler">Apply</button>
      </main>
    `;

    const action = findApplyAction("builtin", "job-page");

    expect(action).not.toBeNull();
    expect(action?.type).toBe("navigate");
    if (action?.type === "navigate") {
      expect(action.url).toBe(
        "https://jobs.ashbyhq.com/example/6462d3d1-443c-4a5a-8667-c1d0472fa32d"
      );
    }
  });

  it("ignores Built In internal job links that look like apply actions", () => {
    document.body.innerHTML = `
      <main class="job-post">
        <a
          href="https://builtin.com/job/another-software-engineer/9876543"
          aria-label="Apply"
          class="related-job-link"
        >
          Apply
        </a>
        <a
          href="https://jobs.ashbyhq.com/example/6462d3d1-443c-4a5a-8667-c1d0472fa32d"
          class="job-post-sticky-bar-btn"
        >
          Apply on company site
        </a>
      </main>
    `;

    const action = findApplyAction("builtin", "job-page");

    expect(action).not.toBeNull();
    expect(action?.type).toBe("navigate");
    if (action?.type === "navigate") {
      expect(action.url).toBe(
        "https://jobs.ashbyhq.com/example/6462d3d1-443c-4a5a-8667-c1d0472fa32d"
      );
    }
  });

  it("returns no Built In apply action when only internal Built In job links are present", () => {
    document.body.innerHTML = `
      <main class="job-post">
        <a
          href="https://builtin.com/job/another-software-engineer/9876543"
          aria-label="Apply"
          class="related-job-link"
        >
          Apply
        </a>
      </main>
    `;

    expect(findApplyAction("builtin", "job-page")).toBeNull();
  });

  it("prefers the Built In apply action on the current job surface over related-job CTAs", () => {
    document.body.innerHTML = `
      <main class="job-post">
        <section class="job-post-details">
          <h1>Senior Platform Engineer</h1>
          <a
            href="https://jobs.ashbyhq.com/example/current-role"
            class="job-post-sticky-bar-btn"
          >
            Apply on company site
          </a>
        </section>
      </main>
      <aside class="related-jobs">
        <article>
          <h2>Other Engineer</h2>
          <a
            href="https://jobs.ashbyhq.com/example/other-role"
            aria-label="Apply externally"
          >
            Apply externally
          </a>
        </article>
      </aside>
    `;

    const action = findApplyAction("builtin", "job-page");

    expect(action).not.toBeNull();
    expect(action?.type).toBe("navigate");
    if (action?.type === "navigate") {
      expect(action.url).toBe("https://jobs.ashbyhq.com/example/current-role");
    }
  });
});
