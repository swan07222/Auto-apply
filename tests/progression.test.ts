import { afterEach, describe, expect, it, vi } from "vitest";

import { handleProgressionAction } from "../src/content/progression";

describe("progression helpers", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits for a delayed application surface after a same-tab navigation", async () => {
    vi.useFakeTimers();

    const button = document.createElement("button");
    button.textContent = "Continue";
    button.addEventListener("click", () => {
      window.history.pushState({}, "", "/apply");
    });
    document.body.appendChild(button);

    const promise = handleProgressionAction({
      site: "indeed",
      progression: {
        type: "click",
        element: button,
        description: "Continue",
        text: "Continue",
      },
      updateStatus: vi.fn(),
      navigateCurrentTab: vi.fn(),
      waitForHumanVerificationToClear: vi.fn().mockResolvedValue(undefined),
      hasLikelyApplicationSurface: vi.fn().mockReturnValue(false),
      waitForLikelyApplicationSurface: vi.fn().mockResolvedValue(true),
      reopenApplyStage: vi.fn().mockResolvedValue(undefined),
      collectAutofillFields: () => [],
    });

    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBe(true);
  });

  it("reopens the apply stage when a progression click never surfaces a form", async () => {
    vi.useFakeTimers();

    const button = document.createElement("button");
    button.textContent = "Next";
    document.body.appendChild(button);

    const reopenApplyStage = vi.fn().mockResolvedValue(undefined);
    const waitForHumanVerificationToClear = vi.fn().mockResolvedValue(undefined);
    const waitForLikelyApplicationSurface = vi.fn().mockResolvedValue(false);

    const promise = handleProgressionAction({
      site: "startup",
      progression: {
        type: "click",
        element: button,
        description: "Next",
        text: "Next",
      },
      updateStatus: vi.fn(),
      navigateCurrentTab: vi.fn(),
      waitForHumanVerificationToClear,
      hasLikelyApplicationSurface: vi.fn().mockReturnValue(false),
      waitForLikelyApplicationSurface,
      reopenApplyStage,
      collectAutofillFields: () => [],
    });

    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBe(false);
    expect(waitForHumanVerificationToClear).not.toHaveBeenCalled();
    expect(waitForLikelyApplicationSurface).toHaveBeenCalledWith("startup");
    expect(reopenApplyStage).toHaveBeenCalledWith("startup");
  });
});
