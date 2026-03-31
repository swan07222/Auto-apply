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

  it("recognizes Gem-hosted company application pages on Built In sessions", () => {
    window.history.replaceState({}, "", "/ondo-finance/gem-1");
    document.body.innerHTML = `
      <main>
        <h1>Ready to apply?</h1>
        <p>Powered by Gem</p>
        <section aria-label="Candidate Profile">
          <label>
            First name
            <input name="first_name" type="text" autocomplete="given-name" />
          </label>
          <label>
            Last name
            <input name="last_name" type="text" autocomplete="family-name" />
          </label>
          <label>
            Email
            <input name="email" type="email" autocomplete="email" />
          </label>
          <button type="button">Continue</button>
        </section>
      </main>
    `;

    expect(hasLikelyApplicationPageContent()).toBe(true);
    expect(hasLikelyApplicationSurface("builtin", collectors)).toBe(true);
  });

  it("keeps Gem final review steps with only a submit action classified as application surfaces", () => {
    window.history.replaceState({}, "", "/ondo-finance/gem-review");
    document.body.innerHTML = `
      <main>
        <p>Powered by Gem</p>
        <section>
          <h2>Review your application</h2>
          <p>Review your application details, then submit.</p>
          <button type="submit">Submit Application</button>
        </section>
      </main>
    `;

    expect(hasLikelyApplicationPageContent()).toBe(true);
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

  it("recognizes Greenhouse final review surfaces that only expose submit application", () => {
    document.body.innerHTML = `
      <section
        role="dialog"
        aria-modal="true"
        class="greenhouse-application-drawer"
        data-testid="greenhouse-application-shell"
      >
        <h2>Review your application</h2>
        <p>Submit application when everything looks right.</p>
        <label>
          First Name
          <input name="first_name" type="text" autocomplete="given-name" value="Ava" />
        </label>
        <label>
          Last Name
          <input name="last_name" type="text" autocomplete="family-name" value="Stone" />
        </label>
        <button>Submit Application</button>
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

  it("jumps directly to far-below Greenhouse form fields that already exist in the DOM", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <main>
        <section style="height: 2400px">
          <h1>Job details</h1>
        </section>
        <form id="application-form">
          <input
            id="greenhouse-first-name"
            type="text"
            autocomplete="given-name"
            aria-label="First name"
          />
          <input
            id="greenhouse-email"
            type="email"
            autocomplete="email"
            aria-label="Email"
          />
        </form>
      </main>
    `;

    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 900,
    });
    Object.defineProperty(document.body, "scrollHeight", {
      configurable: true,
      value: 4200,
    });
    Object.defineProperty(document.documentElement, "scrollHeight", {
      configurable: true,
      value: 4200,
    });

    let appliedScrollTop = 0;
    const firstName = document.querySelector<HTMLInputElement>(
      "#greenhouse-first-name"
    );
    const email = document.querySelector<HTMLInputElement>("#greenhouse-email");
    const form = document.querySelector<HTMLElement>("#application-form");

    expect(firstName).not.toBeNull();
    expect(email).not.toBeNull();
    expect(form).not.toBeNull();

    const offscreenTop = 3150;
    const visibleTop = 320;
    const fieldRect = () => {
      const top = appliedScrollTop >= 2800 ? visibleTop : offscreenTop;
      return {
        x: 0,
        y: top,
        top,
        left: 0,
        bottom: top + 48,
        right: 320,
        width: 320,
        height: 48,
        toJSON() {
          return this;
        },
      };
    };
    const formRect = () => {
      const top = appliedScrollTop >= 2800 ? visibleTop - 120 : offscreenTop - 120;
      return {
        x: 0,
        y: top,
        top,
        left: 0,
        bottom: top + 220,
        right: 640,
        width: 640,
        height: 220,
        toJSON() {
          return this;
        },
      };
    };

    Object.defineProperty(firstName as HTMLInputElement, "getBoundingClientRect", {
      configurable: true,
      value: fieldRect,
    });
    Object.defineProperty(email as HTMLInputElement, "getBoundingClientRect", {
      configurable: true,
      value: fieldRect,
    });
    Object.defineProperty(form as HTMLElement, "getBoundingClientRect", {
      configurable: true,
      value: formRect,
    });

    const scrollSpy = vi.spyOn(window, "scrollTo").mockImplementation((value) => {
      if (typeof value === "object" && value !== null && "top" in value) {
        appliedScrollTop = Number(value.top ?? 0);
      }
    });

    const promise = waitForLikelyApplicationSurface("greenhouse", collectors);

    await vi.advanceTimersByTimeAsync(1_200);

    await expect(promise).resolves.toBe(true);
    expect(scrollSpy).toHaveBeenCalled();
    expect(
      scrollSpy.mock.calls.some(([value]) =>
        typeof value === "object" &&
        value !== null &&
        "top" in value &&
        Number(value.top ?? 0) >= 2800
      )
    ).toBe(true);
  });

  it("scrolls to an offscreen Greenhouse launch shell before treating it as ready", async () => {
    document.body.innerHTML = `
      <main>
        <section style="height: 2400px">
          <h1>Job details</h1>
        </section>
        <section
          id="greenhouse-launch-shell"
          role="dialog"
          aria-modal="true"
          class="greenhouse-application-drawer"
          data-testid="greenhouse-application-shell"
        >
          <p>Powered by Greenhouse</p>
          <button type="button">Autofill with Resume</button>
        </section>
      </main>
    `;

    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 900,
    });
    Object.defineProperty(document.body, "scrollHeight", {
      configurable: true,
      value: 4200,
    });
    Object.defineProperty(document.documentElement, "scrollHeight", {
      configurable: true,
      value: 4200,
    });

    let appliedScrollTop = 0;
    const shell = document.querySelector<HTMLElement>("#greenhouse-launch-shell");

    expect(shell).not.toBeNull();

    const shellRect = () => {
      const top = appliedScrollTop >= 2800 ? 300 : 3150;
      return {
        x: 0,
        y: top,
        top,
        left: 0,
        bottom: top + 260,
        right: 720,
        width: 720,
        height: 260,
        toJSON() {
          return this;
        },
      };
    };

    Object.defineProperty(shell as HTMLElement, "getBoundingClientRect", {
      configurable: true,
      value: shellRect,
    });

    const scrollSpy = vi.spyOn(window, "scrollTo").mockImplementation((value) => {
      if (typeof value === "object" && value !== null && "top" in value) {
        appliedScrollTop = Number(value.top ?? 0);
      }
    });

    await expect(
      waitForLikelyApplicationSurface("greenhouse", collectors)
    ).resolves.toBe(true);

    expect(scrollSpy).toHaveBeenCalled();
    expect(
      scrollSpy.mock.calls.some(([value]) =>
        typeof value === "object" &&
        value !== null &&
        "top" in value &&
        Number(value.top ?? 0) >= 2800
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
