// Note: describe, expect, it are provided globally by vitest (globals: true)

import {
  findDiceUploadPanel,
  findDiceResumeMenuButton,
  findDiceResumePanel,
  findScopedResumeUploadContainer,
  getResumeAssetUploadKey,
  getSelectedFileName,
  hasSelectedMatchingFile,
  inferResumeKindFromLabel,
  isLikelyCoverLetterFileInput,
  pickResumeUploadTargets,
  pickResumeAssetForUpload,
  resolveResumeKindForJob,
  scoreResumeFileInputPreference,
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
    expect(hasSelectedMatchingFile(withFiles, "frontend-resume.pdf")).toBe(true);
    expect(hasSelectedMatchingFile(withValue, "resume.pdf")).toBe(false);
  });

  it("retries upload when a different resume is already attached", () => {
    const input = document.createElement("input");
    input.type = "file";

    Object.defineProperty(input, "files", {
      configurable: true,
      value: [{ name: "old-resume.pdf" }],
    });

    expect(
      shouldAttemptResumeUpload(input, "new-resume.pdf", null, 1_000_000)
    ).toBe(true);
    expect(
      shouldAttemptResumeUpload(
        input,
        "old-resume.pdf",
        null,
        1_000_000,
        20_000,
        true
      )
    ).toBe(false);
  });

  it("does not trust a matching file name unless the extension uploaded that resume", () => {
    const input = document.createElement("input");
    input.type = "file";

    Object.defineProperty(input, "files", {
      configurable: true,
      value: [{ name: "resume.pdf" }],
    });

    expect(
      shouldAttemptResumeUpload(input, "resume.pdf", null, 1_000_000)
    ).toBe(true);
    expect(
      shouldAttemptResumeUpload(input, "resume.pdf", null, 1_000_000, 20_000, true)
    ).toBe(false);
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

  it("creates a stable upload key for the stored extension resume", () => {
    expect(
      getResumeAssetUploadKey({
        name: "Resume.PDF",
        size: 42.4,
        updatedAt: 1234.8,
      })
    ).toBe("resume.pdf:42:1235");
  });

  it("prefers resume inputs over cover-letter inputs on multi-file forms", () => {
    document.body.innerHTML = `
      <form>
        <label for="cover">Upload cover letter</label>
        <input id="cover" type="file" />
        <label for="resume">Upload resume</label>
        <input id="resume" type="file" />
      </form>
    `;

    const coverInput = document.querySelector("#cover") as HTMLInputElement;
    const resumeInput = document.querySelector("#resume") as HTMLInputElement;

    expect(scoreResumeFileInputPreference(coverInput, 2)).toBeLessThan(0);
    expect(scoreResumeFileInputPreference(resumeInput, 2)).toBeGreaterThan(0);
    expect(scoreResumeFileInputPreference(resumeInput, 2)).toBeGreaterThan(
      scoreResumeFileInputPreference(coverInput, 2)
    );
  });

  it("rejects generic file inputs when only the surrounding container says cover letter", () => {
    document.body.innerHTML = `
      <div>
        <div>Cover Letter</div>
        <input id="cover-generic" type="file" />
      </div>
      <div>
        <div>Resume</div>
        <input id="resume-generic" type="file" />
      </div>
    `;

    const coverInput = document.querySelector("#cover-generic") as HTMLInputElement;
    const resumeInput = document.querySelector("#resume-generic") as HTMLInputElement;

    expect(scoreResumeFileInputPreference(coverInput, 2)).toBeLessThan(0);
    expect(scoreResumeFileInputPreference(resumeInput, 2)).toBeGreaterThan(0);
  });

  it("prefers the Dice resume panel over the cover-letter panel", () => {
    document.body.innerHTML = `
      <section class="dice-apply-form">
        <div class="upload-panel cover-letter-panel">
          <h3>Cover Letter</h3>
          <label for="dice-cover">Upload cover letter</label>
          <input id="dice-cover" name="coverLetterFile" type="file" />
        </div>
        <div class="upload-panel resume-panel">
          <h3>Resume</h3>
          <label for="dice-resume">Upload resume</label>
          <input id="dice-resume" name="resumeFile" type="file" accept=".pdf,.doc,.docx" />
        </div>
      </section>
    `;

    const coverInput = document.querySelector("#dice-cover") as HTMLInputElement;
    const resumeInput = document.querySelector("#dice-resume") as HTMLInputElement;

    expect(scoreResumeFileInputPreference(coverInput, 2)).toBeLessThan(0);
    expect(scoreResumeFileInputPreference(resumeInput, 2)).toBeGreaterThan(0);
    expect(scoreResumeFileInputPreference(resumeInput, 2)).toBeGreaterThan(
      scoreResumeFileInputPreference(coverInput, 2)
    );
  });

  it("keeps targeting the populated resume field instead of the empty cover-letter field", () => {
    document.body.innerHTML = `
      <section>
        <div>
          <div>Resume</div>
          <input id="resume-existing" name="resume" type="file" />
        </div>
        <div>
          <div>Cover letter</div>
          <input id="cover-empty" name="coverLetter" type="file" />
        </div>
      </section>
    `;

    const resumeInput = document.querySelector("#resume-existing") as HTMLInputElement;
    const coverInput = document.querySelector("#cover-empty") as HTMLInputElement;

    Object.defineProperty(resumeInput, "files", {
      configurable: true,
      value: [{ name: "site-profile-resume.pdf" }],
    });

    const selection = pickResumeUploadTargets({
      inputs: [resumeInput, coverInput],
      assetName: "custom-resume.pdf",
      uploadKey: "custom-resume.pdf:1:1",
      extensionManagedUploads: new Map(),
    });

    expect(selection.alreadySatisfied).toBeNull();
    expect(selection.targets).toEqual([resumeInput]);
  });

  it("never treats the cover-letter uploader as a resume target", () => {
    document.body.innerHTML = `
      <section>
        <div>
          <div>Cover letter</div>
          <label for="cover-only">Upload your cover letter</label>
          <input id="cover-only" name="coverLetterFile" type="file" />
        </div>
      </section>
    `;

    const coverInput = document.querySelector("#cover-only") as HTMLInputElement;

    expect(isLikelyCoverLetterFileInput(coverInput)).toBe(true);
    expect(
      pickResumeUploadTargets({
        inputs: [coverInput],
        assetName: "resume.pdf",
        uploadKey: "resume.pdf:1:1",
        extensionManagedUploads: new Map(),
      }).targets
    ).toEqual([]);
  });

  it("scopes resume upload events to the resume panel instead of the whole form", () => {
    document.body.innerHTML = `
      <form class="dice-apply-form">
        <div class="panel resume-panel">
          <div>Resume</div>
          <label for="resume-file">Upload your resume</label>
          <input id="resume-file" name="resumeFile" type="file" />
        </div>
        <div class="panel cover-panel">
          <div>Cover letter</div>
          <label for="cover-file">Upload your cover letter</label>
          <input id="cover-file" name="coverLetterFile" type="file" />
        </div>
      </form>
    `;

    const resumeInput = document.querySelector("#resume-file") as HTMLInputElement;
    const scoped = findScopedResumeUploadContainer(resumeInput);

    expect(scoped).toBe(document.querySelector(".resume-panel"));
    expect(scoped).not.toBe(document.querySelector("form"));
  });

  it("finds the existing Dice resume panel instead of the cover-letter panel", () => {
    document.body.innerHTML = `
      <section class="resume-cover-wrapper">
        <div class="resume-card">
          <div>Resume</div>
          <div>Gary Cole Resume.pdf</div>
          <div>Uploaded to application on 3/21/2026</div>
          <button aria-label="More resume actions">...</button>
        </div>
        <div class="cover-card">
          <div>Cover letter</div>
          <div>Upload your cover letter</div>
          <button aria-label="Upload cover letter">Upload</button>
        </div>
      </section>
    `;

    for (const element of Array.from(document.querySelectorAll<HTMLElement>(".resume-card, .cover-card, button"))) {
      Object.defineProperty(element, "getBoundingClientRect", {
        configurable: true,
        value: () => ({
          width: 200,
          height: 40,
          top: 0,
          left: 0,
          right: 200,
          bottom: 40,
        }),
      });
    }

    const panel = findDiceResumePanel();

    expect(panel).toBe(document.querySelector(".resume-card"));
  });

  it("finds both Dice resume and cover-letter panels by kind", () => {
    document.body.innerHTML = `
      <section class="resume-cover-wrapper">
        <div class="resume-card">
          <div>Resume</div>
          <div>Upload your resume</div>
        </div>
        <div class="cover-card">
          <div>Cover letter</div>
          <div>Upload your cover letter</div>
          <div>Optional</div>
        </div>
      </section>
    `;

    for (const element of Array.from(document.querySelectorAll<HTMLElement>(".resume-card, .cover-card"))) {
      Object.defineProperty(element, "getBoundingClientRect", {
        configurable: true,
        value: () => ({
          width: 200,
          height: 60,
          top: 0,
          left: 0,
          right: 200,
          bottom: 60,
        }),
      });
    }

    expect(findDiceUploadPanel("resume")).toBe(
      document.querySelector(".resume-card")
    );
    expect(findDiceUploadPanel("cover_letter")).toBe(
      document.querySelector(".cover-card")
    );
  });

  it("finds the three-dot Dice resume actions button", () => {
    document.body.innerHTML = `
      <div class="resume-card">
        <div>Resume</div>
        <div>Gary Cole Resume.pdf</div>
        <div>Uploaded to application on 3/21/2026</div>
        <button aria-label="More resume actions">...</button>
        <button aria-label="Download resume">Download</button>
      </div>
    `;

    const panel = document.querySelector(".resume-card") as HTMLElement;
    for (const element of Array.from(panel.querySelectorAll<HTMLElement>("button")).concat(panel)) {
      Object.defineProperty(element, "getBoundingClientRect", {
        configurable: true,
        value: () => ({
          width: 120,
          height: 32,
          top: 0,
          left: 0,
          right: 120,
          bottom: 32,
        }),
      });
    }

    const menuButton = findDiceResumeMenuButton(panel);

    expect(menuButton).toBe(panel.querySelector("button[aria-label='More resume actions']"));
  });
});
