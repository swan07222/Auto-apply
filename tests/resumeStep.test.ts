import { describe, expect, it } from "vitest";

import {
  hasPendingResumeUploadSurface,
  hasSelectedResumeUpload,
  isResumeUploadOnlySurface,
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

    expect(isResumeUploadOnlySurface(collectors)).toBe(true);
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
    expect(isResumeUploadOnlySurface(collectors)).toBe(true);
    expect(hasPendingResumeUploadSurface(collectors)).toBe(true);
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

    expect(isResumeUploadOnlySurface(collectors)).toBe(false);
    expect(hasPendingResumeUploadSurface(collectors)).toBe(false);
  });
});
