import { describe, expect, it } from "vitest";

import {
  getSelectedFileName,
  shouldAttemptResumeUpload,
} from "../src/content/resumeUpload";

describe("resume upload helpers", () => {
  it("reads selected file names from files collections and fakepath values", () => {
    const withFiles = document.createElement("input");
    withFiles.type = "file";
    Object.defineProperty(withFiles, "files", {
      configurable: true,
      value: [{ name: "frontend-resume.pdf" }],
    });

    const withValue = document.createElement("input");
    withValue.type = "file";
    Object.defineProperty(withValue, "value", {
      configurable: true,
      value: "C:\\fakepath\\backend-resume.pdf",
    });

    expect(getSelectedFileName(withFiles)).toBe("frontend-resume.pdf");
    expect(getSelectedFileName(withValue)).toBe("backend-resume.pdf");
  });

  it("retries upload when a different resume is already attached", () => {
    const input = document.createElement("input");
    input.type = "file";

    Object.defineProperty(input, "files", {
      configurable: true,
      value: [{ name: "old-resume.pdf" }],
    });

    expect(shouldAttemptResumeUpload(input, "new-resume.pdf", null, 1_000_000)).toBe(true);
    expect(shouldAttemptResumeUpload(input, "old-resume.pdf", null, 1_000_000)).toBe(false);
  });

  it("respects the retry cooldown and disabled inputs", () => {
    const input = document.createElement("input");
    input.type = "file";

    expect(shouldAttemptResumeUpload(input, "resume.pdf", 995_000, 1_000_000)).toBe(false);
    expect(shouldAttemptResumeUpload(input, "resume.pdf", 970_000, 1_000_000)).toBe(true);

    input.disabled = true;
    expect(shouldAttemptResumeUpload(input, "resume.pdf", null, 1_000_000)).toBe(false);
  });
});
