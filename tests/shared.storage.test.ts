import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AUTOMATION_SETTINGS_STORAGE_KEY,
  DEFAULT_PROFILE_ID,
  STARTUP_COMPANIES,
  STARTUP_COMPANIES_CACHE_STORAGE_KEY,
  STARTUP_COMPANIES_FEED_URL,
  createAutomationProfile,
  getActiveAutomationProfile,
  hasConfiguredSearchKeywords,
  parseSearchKeywords,
  readAutomationSettings,
  readStartupCompanyCache,
  refreshStartupCompanies,
  resolveAutomationSettingsForProfile,
  sanitizeAutomationSettings,
  writeAutomationSettings,
} from "../src/shared";
import { createMockChromeStorageLocal } from "./helpers/mockChromeStorage";

function installMockChrome(initialState: Record<string, unknown> = {}) {
  const local = createMockChromeStorageLocal(initialState);

  Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    writable: true,
    value: {
      storage: {
        local,
      },
    },
  });

  return local;
}

function createResumeAsset(name: string, updatedAt: number) {
  return {
    name,
    type: "application/pdf",
    dataUrl: "data:application/pdf;base64,abc123",
    textContent: `${name} text`,
    size: 2048,
    updatedAt,
  };
}

describe("shared storage and profile helpers", () => {
  beforeEach(() => {
    installMockChrome();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as Record<string, unknown>).chrome;
    delete (globalThis as Record<string, unknown>).fetch;
  });

  it("normalizes configured search keywords consistently", () => {
    expect(
      parseSearchKeywords("  frontend engineer,\nbackend engineer\r\nfrontend engineer  ")
    ).toEqual(["frontend engineer", "backend engineer"]);
    expect(hasConfiguredSearchKeywords("   \n  ,")).toBe(false);
    expect(hasConfiguredSearchKeywords("platform engineer")).toBe(true);
  });

  it("falls back to the first available profile and scopes settings to the requested profile", () => {
    const profileA = createAutomationProfile("profile-a", "Profile A");
    profileA.candidate.fullName = "Ada Lovelace";

    const profileB = createAutomationProfile("profile-b", "Profile B");
    profileB.candidate.fullName = "Grace Hopper";
    profileB.resume = createResumeAsset("grace-resume.pdf", 2);
    profileB.answers = {
      motivation: {
        question: "Why this role?",
        value: "Distributed systems impact.",
        updatedAt: 3,
      },
    };

    const settings = sanitizeAutomationSettings({
      activeProfileId: "missing-profile",
      profiles: {
        [profileA.id]: profileA,
        [profileB.id]: profileB,
      },
    });

    expect(getActiveAutomationProfile(settings).id).toBe("profile-a");

    const profileBSettings = resolveAutomationSettingsForProfile(
      settings,
      "profile-b"
    );

    expect(profileBSettings.activeProfileId).toBe("profile-b");
    expect(profileBSettings.candidate.fullName).toBe("Grace Hopper");
    expect(profileBSettings.resume?.name).toBe("grace-resume.pdf");
    expect(profileBSettings.resumes).toEqual({
      full_stack: expect.objectContaining({
        name: "grace-resume.pdf",
      }),
    });
    expect(profileBSettings.answers.motivation?.value).toBe(
      "Distributed systems impact."
    );
  });

  it("migrates legacy settings into the default profile when reading from storage", async () => {
    const local = installMockChrome({
      [AUTOMATION_SETTINGS_STORAGE_KEY]: {
        jobPageLimit: 999,
        searchKeywords: " react engineer \n react engineer \n platform engineer ",
        candidate: {
          fullName: "  Ada Lovelace  ",
          email: " ada@example.com ",
        },
        resumes: {
          front_end: createResumeAsset("older-resume.pdf", 10),
          back_end: createResumeAsset("newer-resume.pdf", 20),
        },
        answers: {
          " Why this role? ": {
            question: "Why this role?",
            value: "Mission fit.",
            updatedAt: 1,
          },
        },
      },
    });

    const settings = await readAutomationSettings();

    expect(settings.activeProfileId).toBe(DEFAULT_PROFILE_ID);
    expect(settings.jobPageLimit).toBe(25);
    expect(settings.searchKeywords).toBe("react engineer\nplatform engineer");
    expect(settings.candidate.fullName).toBe("Ada Lovelace");
    expect(settings.resume?.name).toBe("newer-resume.pdf");
    expect(settings.profiles[DEFAULT_PROFILE_ID]?.resume?.name).toBe(
      "newer-resume.pdf"
    );
    expect(settings.answers["why this role"]?.value).toBe("Mission fit.");
    expect(local.state[AUTOMATION_SETTINGS_STORAGE_KEY]).toBeDefined();
  });

  it("queues settings writes and keeps profile data isolated", async () => {
    const profileA = createAutomationProfile("profile-a", "Profile A");
    const profileB = createAutomationProfile("profile-b", "Profile B");

    installMockChrome({
      [AUTOMATION_SETTINGS_STORAGE_KEY]: sanitizeAutomationSettings({
        activeProfileId: "profile-a",
        searchKeywords: "initial keyword",
        profiles: {
          [profileA.id]: profileA,
          [profileB.id]: profileB,
        },
      }),
    });

    const firstWrite = writeAutomationSettings((current) => ({
      activeProfileId: current.activeProfileId,
      candidate: {
        ...current.candidate,
        fullName: "Ada Lovelace",
      },
      answers: {
        impact: {
          question: "Why do you want this role?",
          value: "Impact and scope.",
          updatedAt: 1,
        },
      },
    }));

    const secondWrite = writeAutomationSettings({
      searchKeywords: "react engineer\nplatform engineer",
    });

    await Promise.all([firstWrite, secondWrite]);

    let settings = await readAutomationSettings();
    expect(settings.activeProfileId).toBe("profile-a");
    expect(settings.candidate.fullName).toBe("Ada Lovelace");
    expect(settings.searchKeywords).toBe("react engineer\nplatform engineer");
    expect(settings.profiles["profile-a"]?.answers.impact?.value).toBe(
      "Impact and scope."
    );
    expect(settings.profiles["profile-b"]?.answers).toEqual({});

    settings = await writeAutomationSettings({
      activeProfileId: "profile-b",
      candidate: {
        ...settings.profiles["profile-b"]?.candidate,
        fullName: "Grace Hopper",
      },
      preferenceAnswers: {
        remote: {
          question: "Do you prefer remote work?",
          value: "Yes",
          updatedAt: 2,
        },
      },
    });

    expect(settings.activeProfileId).toBe("profile-b");
    expect(settings.candidate.fullName).toBe("Grace Hopper");
    expect(settings.preferenceAnswers.remote?.value).toBe("Yes");
    expect(settings.profiles["profile-a"]?.candidate.fullName).toBe(
      "Ada Lovelace"
    );
    expect(settings.profiles["profile-a"]?.answers.impact?.value).toBe(
      "Impact and scope."
    );
  });

  it("returns a sanitized startup cache when present", async () => {
    installMockChrome({
      [STARTUP_COMPANIES_CACHE_STORAGE_KEY]: {
        companies: [
          {
            name: " Example Co ",
            careersUrl: "https://jobs.example.com/company#openings",
            regions: ["us", "bad"],
          },
        ],
        updatedAt: 123,
        sourceUrl: "https://example.com/startups.json",
      },
    });

    await expect(readStartupCompanyCache()).resolves.toEqual({
      companies: [
        {
          name: "Example Co",
          careersUrl: "https://jobs.example.com/company",
          regions: ["us"],
        },
      ],
      updatedAt: 123,
      sourceUrl: "https://example.com/startups.json",
    });
  });

  it("uses the fresh startup cache without fetching again", async () => {
    const companies = [
      {
        name: "Cached Startup",
        careersUrl: "https://jobs.cached.example/apply",
        regions: ["us"] as const,
      },
    ];

    installMockChrome({
      [STARTUP_COMPANIES_CACHE_STORAGE_KEY]: {
        companies,
        updatedAt: Date.now(),
        sourceUrl: STARTUP_COMPANIES_FEED_URL,
      },
    });

    const fetchSpy = vi.fn();
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: fetchSpy,
    });

    await expect(refreshStartupCompanies()).resolves.toEqual(companies);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refreshes startup companies from the remote feed and persists the sanitized cache", async () => {
    const local = installMockChrome();
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      async json() {
        return {
          companies: [
            {
              name: " New Startup ",
              careersUrl: "https://jobs.new-startup.com/roles#openings",
              regions: ["eu", "invalid"],
            },
          ],
        };
      },
    });

    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: fetchSpy,
    });

    const companies = await refreshStartupCompanies(true);

    expect(companies).toEqual([
      {
        name: "New Startup",
        careersUrl: "https://jobs.new-startup.com/roles",
        regions: ["eu"],
      },
    ]);
    expect(fetchSpy).toHaveBeenCalledWith(STARTUP_COMPANIES_FEED_URL, {
      cache: "no-store",
    });
    expect(local.state[STARTUP_COMPANIES_CACHE_STORAGE_KEY]).toEqual(
      expect.objectContaining({
        sourceUrl: STARTUP_COMPANIES_FEED_URL,
        companies,
      })
    );
  });

  it("falls back to bundled startup companies when refresh fails without cache", async () => {
    installMockChrome();
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: vi.fn().mockRejectedValue(new Error("network down")),
    });

    await expect(refreshStartupCompanies(true)).resolves.toEqual(
      STARTUP_COMPANIES
    );
  });
});
