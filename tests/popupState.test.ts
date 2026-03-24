import { derivePopupIdlePreview, getSelectedSearchMode, getStartButtonLabel, shouldDisableStartButtonForSession } from "../src/popupState";

describe("popup state helpers", () => {
  it("derives idle preview for startup mode without requiring an active tab", () => {
    const preview = derivePopupIdlePreview({
      searchMode: "startup_careers",
      activeSite: null,
      activeTabId: null,
      hasKeywords: true,
      regionLabel: "EU",
      supportedJobBoardPrompt: "Open a supported site.",
    });

    expect(preview.status.site).toBe("startup");
    expect(preview.status.message).toBe("Ready to open startup career pages for EU companies.");
    expect(preview.startDisabled).toBe(false);
  });

  it("disables job-board mode when no supported site is active", () => {
    const preview = derivePopupIdlePreview({
      searchMode: "job_board",
      activeSite: null,
      activeTabId: 42,
      hasKeywords: true,
      regionLabel: "US",
      supportedJobBoardPrompt: "Open a supported site.",
    });

    expect(preview.status.site).toBe("unsupported");
    expect(preview.startDisabled).toBe(true);
  });

  it("parses select values defensively and returns button labels", () => {
    expect(getSelectedSearchMode("startup_careers")).toBe("startup_careers");
    expect(getSelectedSearchMode("other_job_sites")).toBe("other_job_sites");
    expect(getSelectedSearchMode("invalid")).toBe("job_board");
    expect(getStartButtonLabel("job_board")).toBe("Start Auto Search");
  });

  it("disables the start button only while a matching session is busy", () => {
    expect(
      shouldDisableStartButtonForSession("job_board", "indeed", {
        site: "indeed",
        phase: "running",
        message: "Working",
        updatedAt: 1,
      })
    ).toBe(true);
    expect(
      shouldDisableStartButtonForSession("other_job_sites", null, {
        site: "other_sites",
        phase: "idle",
        message: "Ready",
        updatedAt: 1,
      })
    ).toBe(false);
  });
});
