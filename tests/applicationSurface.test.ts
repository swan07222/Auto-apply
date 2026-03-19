import { describe, expect, it } from "vitest";

import {
  findStandaloneApplicationFrameUrl,
  hasLikelyApplicationFrame,
  hasLikelyApplicationPageContent,
} from "../src/content/applicationSurface";
import { AutofillField } from "../src/content/types";

const collectors = {
  collectAutofillFields: () =>
    Array.from(document.querySelectorAll<AutofillField>("input, textarea, select")),
  collectResumeFileInputs: () =>
    Array.from(document.querySelectorAll<HTMLInputElement>("input[type='file']")),
};

describe("application surface helpers", () => {
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
});
