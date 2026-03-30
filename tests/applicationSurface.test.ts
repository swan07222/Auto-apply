// Note: describe, expect, it, afterEach are provided globally by vitest (globals: true)
// vi must be imported for mocking
import { vi } from "vitest";

import {
  findStandaloneApplicationFrameUrl,
  hasLikelyApplicationForm,
  hasLikelyApplicationFrame,
  hasLikelyApplicationPageContent,
  hasLikelyApplicationSurface,
  isLikelyApplicationField,
  waitForLikelyApplicationSurface,
} from "../src/content/applicationSurface";
import { AutofillField } from "../src/content/types";

const collectors = {
  collectAutofillFields: () =>
    Array.from(document.querySelectorAll<AutofillField>("input, textarea, select")),
  collectResumeFileInputs: () =>
    Array.from(document.querySelectorAll<HTMLInputElement>("input[type='file']")),
};

describe("application surface helpers", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the embedded application URL when the page only hosts an iframe", () => {
    document.body.innerHTML = `
      <section>
        <iframe src="https://boards.greenhouse.io/embed/job_app?for=example&token=abc123"></iframe>
      </section>
    `;

    expect(findStandaloneApplicationFrameUrl(collectors)).toBe(
      "https://boards.greenhouse.io/embed/job_app?for=example&token=abc123"
    );
  });

  it("keeps the current page when local application fields are already present", () => {
    document.body.innerHTML = `
      <section>
        <iframe src="https://boards.greenhouse.io/embed/job_app?for=example&token=abc123"></iframe>
        <form>
          <label for="first-name">First Name</label>
          <input id="first-name" type="text" />
          <label for="email">Email</label>
          <input id="email" type="email" />
        </form>
      </section>
    `;

    expect(findStandaloneApplicationFrameUrl(collectors)).toBeNull();
  });

  it("ignores hidden placeholder iframes when detecting an application frame", () => {
    document.body.innerHTML = `
      <section>
        <iframe
          class="apply-frame"
          src="https://boards.greenhouse.io/embed/job_app?for=hidden&token=abc123"
          style="display:none"
        ></iframe>
      </section>
    `;

    expect(hasLikelyApplicationFrame()).toBe(false);
    expect(findStandaloneApplicationFrameUrl(collectors)).toBeNull();
  });

  it("prefers the visible standalone application frame when both hidden and visible frames exist", () => {
    document.body.innerHTML = `
      <section>
        <iframe
          class="apply-frame"
          src="https://boards.greenhouse.io/embed/job_app?for=hidden&token=abc123"
          style="display:none"
        ></iframe>
        <iframe
          src="https://jobs.lever.co/example/abcd1234/apply"
          title="Application form"
        ></iframe>
      </section>
    `;

    expect(hasLikelyApplicationFrame()).toBe(true);
    expect(findStandaloneApplicationFrameUrl(collectors)).toBe(
      "https://jobs.lever.co/example/abcd1234/apply"
    );
  });

  it("recognizes Glassdoor start-application modals as application page content", () => {
    document.body.innerHTML = `
      <section role="dialog" aria-modal="true">
        <h2>You're on your way to apply</h2>
        <button>Start My Application</button>
      </section>
    `;

    expect(hasLikelyApplicationPageContent()).toBe(true);
  });

  it("recognizes final review pages with submit actions as application page content", () => {
    document.body.innerHTML = `
      <main>
        <h1>Please review your application</h1>
        <p>You will not be able to make changes after you submit your application.</p>
        <button type="button">Back</button>
        <button type="submit">Submit</button>
      </main>
    `;

    expect(hasLikelyApplicationPageContent()).toBe(true);
  });

  it("rejects generic search inputs when deciding whether a field belongs to an application form", () => {
    document.body.innerHTML = `
      <form>
        <label>
          Search jobs
          <input id="job-search" type="search" />
        </label>
        <label>
          Where
          <input id="location-search" type="text" />
        </label>
      </form>
    `;

    const searchInput = document.querySelector<HTMLInputElement>("#job-search");
    const locationInput =
      document.querySelector<HTMLInputElement>("#location-search");

    expect(searchInput).not.toBeNull();
    expect(locationInput).not.toBeNull();
    expect(isLikelyApplicationField(searchInput as AutofillField)).toBe(false);
    expect(hasLikelyApplicationForm(collectors)).toBe(false);
  });

  it("treats a visible resume upload as an application form signal", () => {
    document.body.innerHTML = `
      <form>
        <label>
          Upload resume
          <input type="file" />
        </label>
      </form>
    `;

    expect(hasLikelyApplicationForm(collectors)).toBe(true);
  });

  it("recognizes Monster inline apply drawers even when the job page remains visible", () => {
    document.body.innerHTML = `
      <main class="job-detail-panel">
        <section class="job-description">
          <button type="button">Quick Apply</button>
        </section>
        <section
          role="dialog"
          aria-modal="true"
          class="monster-apply-drawer"
          data-testid="candidate-apply-drawer"
        >
          <p>Continue your application by uploading your resume.</p>
          <button data-testid="continue-application">Continue</button>
        </section>
      </main>
    `;

    expect(hasLikelyApplicationSurface("monster", collectors)).toBe(true);
  });

  it("recognizes Built In ATS launch modals before the external application opens", () => {
    document.body.innerHTML = `
      <main class="job-post">
        <button>Apply</button>
      </main>
      <section role="dialog" aria-modal="true">
        <h2>Start Your Application</h2>
        <button>Autofill with Resume</button>
        <button>Apply Manually</button>
        <button>Use My Last Application</button>
      </section>
    `;

    expect(hasLikelyApplicationSurface("builtin", collectors)).toBe(true);
  });

  it("recognizes Greenhouse launch surfaces before the embedded form fully renders", () => {
    document.body.innerHTML = `
      <main class="job-post">
        <button>Apply</button>
      </main>
      <section
        role="dialog"
        aria-modal="true"
        class="greenhouse-application-drawer"
        data-testid="greenhouse-application-shell"
      >
        <h2>Apply for this job</h2>
        <p>Powered by Greenhouse</p>
        <p>Upload resume and cover letter to continue application.</p>
        <button>Continue</button>
      </section>
    `;

    expect(hasLikelyApplicationSurface("greenhouse", collectors)).toBe(true);
  });

  it("does not treat a plain Greenhouse job page with only the primary apply CTA as an application surface", () => {
    document.body.innerHTML = `
      <main class="main font-secondary job-post">
        <div class="job__header">
          <a href="/jobs">Back to jobs</a>
          <button type="button" class="btn btn--pill" aria-label="Apply">Apply</button>
        </div>
        <section>
          <h1>Senior Full-Stack Software Engineer</h1>
          <p>Powered by Greenhouse</p>
          <p>Applications reviewed on a rolling basis.</p>
        </section>
      </main>
    `;

    expect(hasLikelyApplicationSurface("greenhouse", collectors)).toBe(false);
  });

  it("waits for a likely application surface to appear after delayed rendering", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<main><h1>Job details</h1></main>`;

    const promise = waitForLikelyApplicationSurface("glassdoor", collectors);

    window.setTimeout(() => {
      document.body.innerHTML = `
        <form>
          <label>
            Full name
            <input type="text" autocomplete="name" />
          </label>
          <label>
            Email
            <input type="email" autocomplete="email" />
          </label>
        </form>
      `;
    }, 1_400);

    await vi.advanceTimersByTimeAsync(2_100);

    await expect(promise).resolves.toBe(true);
  });

  it("scrolls deeper on Greenhouse pages while waiting for an inline application form", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<main><h1>Job details</h1></main>`;

    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 900,
    });
    Object.defineProperty(document.body, "scrollHeight", {
      configurable: true,
      value: 3200,
    });
    Object.defineProperty(document.documentElement, "scrollHeight", {
      configurable: true,
      value: 3200,
    });

    const scrollSpy = vi.spyOn(window, "scrollTo").mockImplementation((value) => {
      const top =
        typeof value === "object" && value !== null && "top" in value
          ? Number(value.top ?? 0)
          : 0;

      if (top >= 1400 && !document.querySelector("#greenhouse-email")) {
        document.body.innerHTML = `
          <main>
            <form>
              <label>
                Full name
                <input type="text" autocomplete="name" />
              </label>
              <label>
                Email
                <input id="greenhouse-email" type="email" autocomplete="email" />
              </label>
            </form>
          </main>
        `;
      }
    });

    const promise = waitForLikelyApplicationSurface("greenhouse", collectors);

    await vi.advanceTimersByTimeAsync(5_000);

    await expect(promise).resolves.toBe(true);
    expect(scrollSpy).toHaveBeenCalled();
    expect(
      scrollSpy.mock.calls.some(([value]) =>
        typeof value === "object" &&
        value !== null &&
        "top" in value &&
        Number(value.top ?? 0) >= 1400
      )
    ).toBe(true);
  });

  it("does not scroll the page while waiting for Monster apply surfaces", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<main><h1>Job details</h1></main>`;

    const scrollSpy = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const promise = waitForLikelyApplicationSurface("monster", collectors);

    window.setTimeout(() => {
      document.body.innerHTML = `
        <section role="dialog" aria-modal="true" class="monster-apply-drawer">
          <p>Continue your application.</p>
          <button data-testid="continue-application">Continue</button>
        </section>
      `;
    }, 4_300);

    await vi.advanceTimersByTimeAsync(5_000);

    await expect(promise).resolves.toBe(true);
    expect(scrollSpy).not.toHaveBeenCalled();
  });
});
