import { describe, expect, it } from "vitest";

import {
  getSelectedFileName,
  inferResumeKindFromLabel,
  pickResumeAssetForUpload,
  resolveResumeKindForJob,
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

  it("infers resume kind from known search labels", () => {
    expect(inferResumeKindFromLabel("Front End")).toBe("front_end");
    expect(inferResumeKindFromLabel("Built In Back End")).toBe("back_end");
    expect(inferResumeKindFromLabel("Full Stack")).toBe("full_stack");
    expect(inferResumeKindFromLabel("Ramp")).toBeUndefined();
  });

  it("keeps the selected resume track instead of overriding it from the job title", () => {
    expect(
      resolveResumeKindForJob({
        preferredResumeKind: "full_stack",
        label: "Full Stack",
        jobTitle: "Senior React Engineer",
      })
    ).toBe("full_stack");

    expect(
      resolveResumeKindForJob({
        preferredResumeKind: "front_end",
        label: "Front End",
        jobTitle: "Backend Platform Engineer",
      })
    ).toBe("front_end");
  });

  it("falls back to label or job title only when the selected track is missing", () => {
    expect(
      resolveResumeKindForJob({
        label: "Built In Back End",
        jobTitle: "Senior React Engineer",
      })
    ).toBe("back_end");

    expect(
      resolveResumeKindForJob({
        jobTitle: "Senior React Engineer",
      })
    ).toBe("front_end");
  });

  it("falls back to the closest resume track when the exact one is missing", () => {
    const frontEndResume = {
      name: "frontend.pdf",
      type: "application/pdf",
      dataUrl: "data:application/pdf;base64,AA==",
      textContent: "",
      size: 1,
      updatedAt: 1,
    };
    const fullStackResume = {
      name: "fullstack.pdf",
      type: "application/pdf",
      dataUrl: "data:application/pdf;base64,BB==",
      textContent: "",
      size: 1,
      updatedAt: 2,
    };

    const settings = {
      resumes: {
        front_end: frontEndResume,
        full_stack: fullStackResume,
      },
    };

    expect(pickResumeAssetForUpload(settings, "front_end")).toBe(frontEndResume);
    expect(pickResumeAssetForUpload(settings, "back_end")).toBe(fullStackResume);
    expect(pickResumeAssetForUpload(settings)).toBe(fullStackResume);
  });
});
