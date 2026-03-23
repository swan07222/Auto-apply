// Note: describe, expect, it, afterEach are provided globally by vitest (globals: true)
// vi must be imported for mocking
import { vi } from "vitest";

import {
  handleProgressionAction,
  waitForReadyProgressionAction,
} from "../src/content/progression";

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

  it("returns a navigate progression immediately without clicking the page", async () => {
    const navigateCurrentTab = vi.fn();
    const beforeAction = vi.fn();
    const waitForHumanVerificationToClear = vi.fn();
    const reopenApplyStage = vi.fn();

    await expect(
      handleProgressionAction({
        site: "glassdoor",
        progression: {
          type: "navigate",
          url: "https://example.com/apply",
          description: "Continue to application",
          text: "Continue to application",
        },
        updateStatus: vi.fn(),
        beforeAction,
        navigateCurrentTab,
        waitForHumanVerificationToClear,
        hasLikelyApplicationSurface: vi.fn(),
        waitForLikelyApplicationSurface: vi.fn(),
        reopenApplyStage,
        collectAutofillFields: () => [],
      })
    ).resolves.toBe(false);

    expect(beforeAction).toHaveBeenCalledTimes(1);
    expect(navigateCurrentTab).toHaveBeenCalledWith("https://example.com/apply");
    expect(waitForHumanVerificationToClear).not.toHaveBeenCalled();
    expect(reopenApplyStage).not.toHaveBeenCalled();
  });

  it("waits until a progression button appears before timing out", async () => {
    vi.useFakeTimers();

    const promise = waitForReadyProgressionAction("glassdoor", 1_000);

    window.setTimeout(() => {
      document.body.innerHTML = `
        <section role="dialog" aria-modal="true">
          <button>Start My Application</button>
        </section>
      `;
    }, 300);

    await vi.advanceTimersByTimeAsync(500);

    await expect(promise).resolves.toEqual(
      expect.objectContaining({
        type: "click",
        text: "Start My Application",
      })
    );
  });

  it("returns null when no progression action appears before the timeout", async () => {
    vi.useFakeTimers();

    const promise = waitForReadyProgressionAction("startup", 400);
    await vi.advanceTimersByTimeAsync(500);

    await expect(promise).resolves.toBeNull();
  });

  it("detects blank file, select, and textarea fields after an in-place progression click", async () => {
    vi.useFakeTimers();

    const button = document.createElement("button");
    button.textContent = "Continue";
    document.body.appendChild(button);

    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "contact-method";

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.setAttribute("aria-label", "Upload resume");

    const select = document.createElement("select");
    select.setAttribute("aria-label", "Work authorization");
    select.innerHTML = `
      <option value="">Select one</option>
      <option value="yes">Yes</option>
    `;

    const textarea = document.createElement("textarea");
    textarea.setAttribute("aria-label", "Cover letter");
    textarea.value = "";

    const promise = handleProgressionAction({
      site: "glassdoor",
      progression: {
        type: "click",
        element: button,
        description: "Continue",
        text: "Continue",
      },
      updateStatus: vi.fn(),
      navigateCurrentTab: vi.fn(),
      waitForHumanVerificationToClear: vi.fn().mockResolvedValue(undefined),
      hasLikelyApplicationSurface: vi.fn().mockReturnValue(true),
      waitForLikelyApplicationSurface: vi.fn().mockResolvedValue(false),
      reopenApplyStage: vi.fn().mockResolvedValue(undefined),
      collectAutofillFields: () => [radio, fileInput, select, textarea],
    });

    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBe(true);
  });

  it("runs the pre-action hook before clicking progression controls", async () => {
    vi.useFakeTimers();

    const button = document.createElement("button");
    button.textContent = "Continue";
    document.body.appendChild(button);

    const beforeAction = vi.fn().mockResolvedValue(undefined);

    const promise = handleProgressionAction({
      site: "indeed",
      progression: {
        type: "click",
        element: button,
        description: "Continue",
        text: "Continue",
      },
      updateStatus: vi.fn(),
      beforeAction,
      navigateCurrentTab: vi.fn(),
      waitForHumanVerificationToClear: vi.fn().mockResolvedValue(undefined),
      hasLikelyApplicationSurface: vi.fn().mockReturnValue(true),
      waitForLikelyApplicationSurface: vi.fn().mockResolvedValue(false),
      reopenApplyStage: vi.fn().mockResolvedValue(undefined),
      collectAutofillFields: () => [],
    });

    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBe(true);
    expect(beforeAction).toHaveBeenCalledTimes(1);
  });
});
