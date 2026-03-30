// Note: describe, expect, it are provided globally by vitest (globals: true)

import {
  hasPendingResumeUploadSurface,
  hasSelectedResumeUpload,
} from "../src/content/resumeStep";
import { AutofillField } from "../src/content/types";

const collectors = {
  collectAutofillFields: () =>
    Array.from(document.querySelectorAll<AutofillField>("input, textarea, select")),
  collectResumeFileInputs: () =>
    Array.from(document.querySelectorAll<HTMLInputElement>("input[type='file']")),
};

describe("resume step helpers", () => {
  it("treats an empty resume-only step as pending", () => {
    document.body.innerHTML = `
      <form>
        <label>
          Upload resume
          <input id="resume" type="file" />
        </label>
      </form>
    `;

    expect(hasPendingResumeUploadSurface(collectors)).toBe(true);
  });

  it("keeps waiting when only the resume step remains after a file is selected", () => {
    document.body.innerHTML = `
      <form>
        <label>
          Upload resume
          <input id="resume" type="file" />
        </label>
      </form>
    `;

    const input = document.querySelector<HTMLInputElement>("#resume");
    expect(input).not.toBeNull();

    Object.defineProperty(input as HTMLInputElement, "files", {
      configurable: true,
      value: [{ name: "resume.pdf" }],
    });

    expect(hasSelectedResumeUpload(input as HTMLInputElement)).toBe(true);
    expect(hasPendingResumeUploadSurface(collectors)).toBe(true);
  });

  it("recognizes accepted Ashby-style resume widgets even when the native file input is blank", () => {
    document.body.innerHTML = `
      <form>
        <section class="resume-panel">
          <label for="resume">Resume/CV *</label>
          <input id="resume" type="file" required />
          <div class="ashby-upload-widget">
            <span>Resume/CV</span>
            <button type="button">Replace file</button>
            <button type="button">Remove file</button>
          </div>
        </section>
      </form>
    `;

    const input = document.querySelector<HTMLInputElement>("#resume");
    expect(input).not.toBeNull();

    expect(hasSelectedResumeUpload(input as HTMLInputElement)).toBe(true);
  });

  it("does not treat a populated application form as a pending resume-only step", () => {
    document.body.innerHTML = `
      <form>
        <label>
          Upload resume
          <input id="resume" type="file" />
        </label>
        <label>
          Email
          <input id="email" type="email" autocomplete="email" />
        </label>
      </form>
    `;

    const input = document.querySelector<HTMLInputElement>("#resume");
    expect(input).not.toBeNull();

    Object.defineProperty(input as HTMLInputElement, "files", {
      configurable: true,
      value: [{ name: "resume.pdf" }],
    });

    expect(hasPendingResumeUploadSurface(collectors)).toBe(false);
  });
});
