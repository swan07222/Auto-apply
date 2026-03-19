import { describe, expect, it } from "vitest";

import {
  collectJobDetailCandidates,
  isCurrentPageAppliedJob,
  isAppliedJobText,
  isLikelyJobDetailUrl,
  looksLikeTechnicalRoleTitle,
  pickRelevantJobUrls,
} from "../src/content/jobSearch";
import type { JobCandidate } from "../src/content/types";

describe("job search candidate filtering", () => {
  it("filters and prioritizes candidates by recency and resume kind", () => {
    const candidates: JobCandidate[] = [
      {
        url: "https://example.com/jobs/front-end-engineer-1",
        title: "Front End Engineer",
        contextText: "Remote role. Posted today.",
      },
      {
        url: "https://example.com/jobs/full-stack-engineer-2",
        title: "Full Stack Engineer",
        contextText: "Remote role. Posted 2 days ago.",
      },
      {
        url: "https://example.com/jobs/back-end-engineer-3",
        title: "Back End Engineer",
        contextText: "Remote role. Posted 1 week ago.",
      },
      {
        url: "https://example.com/jobs/front-end-engineer-4",
        title: "Front End Engineer",
        contextText: "Remote role. Posted 10 days ago.",
      },
    ];

    const urls = pickRelevantJobUrls(
      candidates,
      "other_sites",
      "front_end",
      "3d"
    );

    expect(urls).toEqual([
      "https://example.com/jobs/front-end-engineer-1",
      "https://example.com/jobs/full-stack-engineer-2",
    ]);
  });

  it("accepts Monster detail URLs and rejects listing URLs", () => {
    expect(
      isLikelyJobDetailUrl(
        "monster",
        "https://www.monster.com/job/senior-front-end-engineer-abc123",
        "Senior Front End Engineer"
      )
    ).toBe(true);

    expect(
      isLikelyJobDetailUrl(
        "monster",
        "https://www.monster.com/jobs/q-front-end-developer-jobs-l-remote",
        "Front End Developer jobs"
      )
    ).toBe(false);
  });

  it("collects Monster job cards while skipping search-style links", () => {
    document.body.innerHTML = `
      <article class="job-card">
        <h2>Senior Front End Engineer</h2>
        <a href="https://www.monster.com/job/senior-front-end-engineer-abc123">View job</a>
      </article>
      <article class="job-card">
        <h2>Search all jobs</h2>
        <a href="https://www.monster.com/jobs/search/?q=frontend">Browse jobs</a>
      </article>
    `;

    const urls = pickRelevantJobUrls(collectJobDetailCandidates("monster"), "monster");

    expect(urls).toEqual(["https://www.monster.com/job/senior-front-end-engineer-abc123"]);
  });

  it("collects ATS-backed startup roles and ignores listing CTAs", () => {
    document.body.innerHTML = `
      <section class="careers">
        <a href="https://jobs.lever.co/example">Open jobs</a>
        <article class="opening-card">
          <h3>Backend Engineer</h3>
          <a href="https://jobs.lever.co/example/abcd1234">Apply</a>
        </article>
        <article class="opening-card">
          <h3>Senior Product Manager</h3>
          <a href="https://jobs.lever.co/example/pm-role">Apply</a>
        </article>
      </section>
    `;

    const urls = pickRelevantJobUrls(
      collectJobDetailCandidates("startup"),
      "startup",
      "back_end"
    );

    expect(urls).toEqual(["https://jobs.lever.co/example/abcd1234"]);
  });

  it("collects generic job detail links on other job sites", () => {
    document.body.innerHTML = `
      <article class="job-result">
        <h2>Platform Engineer</h2>
        <a href="https://example.com/careers/jobs/platform-engineer-123">Platform Engineer</a>
      </article>
      <article class="job-result">
        <h2>About us</h2>
        <a href="https://example.com/careers">Careers</a>
      </article>
    `;

    const urls = pickRelevantJobUrls(collectJobDetailCandidates("other_sites"), "other_sites");

    expect(urls).toEqual(["https://example.com/careers/jobs/platform-engineer-123"]);
  });

  it("accepts ATS detail URLs on startup and other job sites but rejects listing pages", () => {
    expect(
      isLikelyJobDetailUrl(
        "startup",
        "https://boards.greenhouse.io/example/jobs/1234567",
        "Front End Engineer"
      )
    ).toBe(true);
    expect(
      isLikelyJobDetailUrl("startup", "https://example.com/careers/jobs", "Open jobs")
    ).toBe(false);
    expect(
      isLikelyJobDetailUrl(
        "other_sites",
        "https://example.com/positions/senior-backend-engineer-42",
        "Senior Backend Engineer"
      )
    ).toBe(true);
  });

  it("identifies technical role titles and current-page applied state", () => {
    document.body.innerHTML = `
      <main>
        <h1>Senior React Engineer</h1>
        <p>Application submitted. You applied 2 days ago.</p>
      </main>
    `;

    expect(looksLikeTechnicalRoleTitle("Senior React Engineer")).toBe(true);
    expect(looksLikeTechnicalRoleTitle("Head of People Operations")).toBe(false);
    expect(isCurrentPageAppliedJob()).toBe(true);
  });

  it("detects applied-job text without false positives for applied scientist roles", () => {
    expect(
      isAppliedJobText("Application submitted. You applied 2 days ago.")
    ).toBe(true);
    expect(isAppliedJobText("Applied Scientist, Search Ranking")).toBe(false);
  });
});
