import { describe, expect, it } from "vitest";

import {
  findApplyAction,
  findCompanySiteAction,
  findMonsterApplyAction,
  findProgressionAction,
  findZipRecruiterApplyAction,
  hasIndeedApplyIframe,
  hasZipRecruiterApplyModal,
  isAlreadyOnApplyPage,
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

  it("extracts Monster apply URLs from custom web components", () => {
    document.body.innerHTML = `
      <apply-button-wc
        id="monster-apply"
        data-apply-url="https://company.example.com/careers/apply"
      ></apply-button-wc>
    `;

    const action = findMonsterApplyAction();

    expect(action).not.toBeNull();
    expect(action?.type).toBe("navigate");
    if (action?.type === "navigate") {
      expect(action.url).toBe("https://company.example.com/careers/apply");
    }
  });

  it("uses Monster shadow-dom apply controls when present", () => {
    const component = document.createElement("apply-button-wc");
    const shadow = component.attachShadow({ mode: "open" });
    shadow.innerHTML = `<a href="https://company.example.com/job/apply">Apply now</a>`;
    document.body.appendChild(component);

    const action = findMonsterApplyAction();

    expect(action).not.toBeNull();
    expect(action?.type).toBe("navigate");
    if (action?.type === "navigate") {
      expect(action.url).toBe("https://company.example.com/job/apply");
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
    expect(action?.type).toBe("navigate");
    if (action?.type === "navigate") {
      expect(action.url).toBe("https://company.example.com/careers/apply/123");
    }
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
        "https://job-boards.greenhouse.io/example/jobs/1234567?gh_jid=1234567",
        "other_sites"
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
});
