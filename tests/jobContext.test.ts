import { describe, expect, it } from "vitest";

import {
  buildChatGptRequestUrl,
  collectBestJobDescriptionText,
  extractCurrentJobContextSnapshot,
  isUsefulJobContextSnapshot,
  mergeJobContextSnapshots,
  prepareResumeAssetForAi,
} from "../src/content/jobContext";
import type { JobContextSnapshot, ResumeAsset } from "../src/shared";

describe("content jobContext helpers", () => {
  it("extracts the best title, company, description, and page url", () => {
    window.history.replaceState({}, "", "/jobs/frontend-123");
    document.title = "Fallback title";
    document.head.innerHTML =
      '<meta name="author" content="Meta Company">';
    document.body.innerHTML = `
      <main>
        <h1>Senior Frontend Engineer</h1>
        <div class="company">Acme Labs</div>
        <section class="description">
          <p>Short copy.</p>
        </section>
        <article id="jobDescriptionText">
          <p>Responsibilities include building design systems, improving performance, partnering with product, and shipping reliable remote experiences for customers across teams.</p>
        </article>
      </main>
    `;

    const snapshot = extractCurrentJobContextSnapshot(
      "Why are you interested in this role?"
    );

    expect(snapshot.title).toBe("Senior Frontend Engineer");
    expect(snapshot.company).toBe("Acme Labs");
    expect(snapshot.question).toBe("Why are you interested in this role?");
    expect(snapshot.description).toContain("Responsibilities include building design systems");
    expect(snapshot.pageUrl).toBe("https://example.com/jobs/frontend-123");
  });

  it("prefers the strongest job description candidate", () => {
    document.body.innerHTML = `
      <main>
        <section class="description">
          <p>Please sign in to continue your application and view more details about the role after logging in.</p>
          <p>This text is long enough to compete but should not win because it looks like application chrome.</p>
        </section>
        <article>
          <p>About the role: you will own frontend architecture, improve accessibility, mentor engineers, and deliver product features with responsibilities across performance, testing, and collaboration.</p>
        </article>
      </main>
    `;

    const description = collectBestJobDescriptionText();

    expect(description).toContain("About the role:");
    expect(description).not.toContain("Please sign in to continue your application");
  });

  it("merges remembered and current context predictably", () => {
    const remembered: JobContextSnapshot = {
      title: "Remembered title",
      company: "Remembered company",
      description: "Remembered description with more detail.",
      question: "",
      pageUrl: "https://example.com/remembered",
    };
    const current: JobContextSnapshot = {
      title: "Current title",
      company: "",
      description: "Short current description",
      question: "",
      pageUrl: "https://example.com/current",
    };

    const merged = mergeJobContextSnapshots(
      remembered,
      current,
      "Why this role?"
    );

    expect(merged.title).toBe("Remembered title");
    expect(merged.company).toBe("Remembered company");
    expect(merged.description).toBe("Remembered description with more detail.");
    expect(merged.question).toBe("Why this role?");
    expect(merged.pageUrl).toBe("https://example.com/current");
  });

  it("detects whether a job context snapshot is useful", () => {
    expect(
      isUsefulJobContextSnapshot({
        title: "",
        company: "",
        description: "too short",
        question: "",
        pageUrl: "",
      })
    ).toBe(false);

    expect(
      isUsefulJobContextSnapshot({
        title: "Frontend Engineer",
        company: "",
        description: "",
        question: "",
        pageUrl: "",
      })
    ).toBe(true);
  });

  it("returns the original resume asset when text is already present", async () => {
    const asset: ResumeAsset = {
      name: "resume.pdf",
      type: "application/pdf",
      dataUrl: "data:application/pdf;base64,ZmFrZQ==",
      textContent: "Existing extracted text",
      size: 10,
      updatedAt: Date.now(),
    };

    const prepared = await prepareResumeAssetForAi(asset);

    expect(prepared).toBe(asset);
  });

  it("builds the ChatGPT request url with the request id", () => {
    const url = new URL(buildChatGptRequestUrl("req-42"));

    expect(url.origin).toBe("https://chatgpt.com");
    expect(url.searchParams.get("remoteJobSearchRequest")).toBe("req-42");
  });
});
