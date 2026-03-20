import { describe, expect, it } from "vitest";

import {
  createStageRetryState,
  getNextStageRetryState,
} from "../src/content/stageFlow";

describe("stageFlow", () => {
  it("increments retries only when re-entering the same stage on the same URL", () => {
    let state = createStageRetryState();

    state = getNextStageRetryState(
      state,
      "open-apply",
      "https://example.com/jobs/123"
    );
    expect(state.depth).toBe(1);

    state = getNextStageRetryState(
      state,
      "open-apply",
      "https://example.com/jobs/123"
    );
    expect(state.depth).toBe(2);
  });

  it("resets retries when the stage changes on the same URL", () => {
    let state = createStageRetryState();

    state = getNextStageRetryState(
      state,
      "open-apply",
      "https://example.com/jobs/123"
    );
    state = getNextStageRetryState(
      state,
      "open-apply",
      "https://example.com/jobs/123"
    );
    expect(state.depth).toBe(2);

    state = getNextStageRetryState(
      state,
      "autofill-form",
      "https://example.com/jobs/123"
    );
    expect(state.depth).toBe(1);
  });

  it("resets retries when navigation advances to a new URL in the same stage", () => {
    let state = createStageRetryState();

    state = getNextStageRetryState(
      state,
      "autofill-form",
      "https://example.com/apply/step-1"
    );
    state = getNextStageRetryState(
      state,
      "autofill-form",
      "https://example.com/apply/step-1"
    );
    expect(state.depth).toBe(2);

    state = getNextStageRetryState(
      state,
      "autofill-form",
      "https://example.com/apply/step-2"
    );
    expect(state.depth).toBe(1);
  });
});
