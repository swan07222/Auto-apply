import { describe, expect, it } from "vitest";

import { findStandaloneApplicationFrameUrl } from "../src/content/applicationSurface";
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
});
