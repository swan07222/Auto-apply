import { afterEach, describe, expect, it, vi } from "vitest";

import {
  findStandaloneApplicationFrameUrl,
  hasLikelyApplicationForm,
  hasLikelyApplicationFrame,
  hasLikelyApplicationPageContent,
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
});
