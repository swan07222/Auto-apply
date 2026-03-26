// Note: describe, expect, it are provided globally by vitest (globals: true)

import { normalizeQuestionKey } from "../src/shared";
import {
  addPendingAnswer,
  getPendingAnswersForProfile,
  mergeSavedAnswerRecords,
  readPendingAnswerBucketsFromFallback,
  removePendingAnswers,
  resolvePendingAnswerTargetProfileId,
  serializePendingAnswerBuckets,
} from "../src/content/pendingAnswers";

describe("pending answer helpers", () => {
  it("keeps pending answers isolated per profile and prefers the newest value", () => {
    const buckets = readPendingAnswerBucketsFromFallback(null);

    addPendingAnswer(buckets, "profile-a", "Why this role?", {
      question: "Why this role?",
      value: "Initial answer",
      updatedAt: 1,
    });
    addPendingAnswer(buckets, "profile-a", "why this role", {
      question: " Why this role? ",
      value: " Updated answer ",
      updatedAt: 2,
    });
    addPendingAnswer(buckets, "profile-b", "Why this role?", {
      question: "Why this role?",
      value: "Different profile answer",
      updatedAt: 3,
    });

    expect(
      getPendingAnswersForProfile(buckets, "profile-a")[
        normalizeQuestionKey("Why this role?")
      ]
    ).toEqual({
      question: "Why this role?",
      value: "Updated answer",
      updatedAt: 2,
    });
    expect(
      getPendingAnswersForProfile(buckets, "profile-b")[
        normalizeQuestionKey("Why this role?")
      ]?.value
    ).toBe("Different profile answer");
  });

  it("round-trips fallback storage and drops invalid saved answers", () => {
    const buckets = readPendingAnswerBucketsFromFallback(
      JSON.stringify({
        "profile-a": {
          " Why this role? ": {
            question: " Why this role? ",
            value: " Impact. ",
            updatedAt: 4,
          },
          bad: {
            question: "",
            value: "",
            updatedAt: 5,
          },
        },
      })
    );

    expect(buckets).toEqual({
      "profile-a": {
        [normalizeQuestionKey("Why this role?")]: {
          question: "Why this role?",
          value: "Impact.",
          updatedAt: 4,
        },
      },
    });

    expect(
      readPendingAnswerBucketsFromFallback(serializePendingAnswerBuckets(buckets))
    ).toEqual(buckets);
  });

  it("migrates legacy fallback entries into the default pending bucket", () => {
    const buckets = readPendingAnswerBucketsFromFallback(
      JSON.stringify([
        [
          "Why this role?",
          {
            question: "Why this role?",
            value: "Impact",
            updatedAt: 6,
          },
        ],
      ])
    );

    expect(
      getPendingAnswersForProfile(buckets, undefined)[
        normalizeQuestionKey("Why this role?")
      ]
    ).toEqual({
      question: "Why this role?",
      value: "Impact",
      updatedAt: 6,
    });
  });

  it("removes acknowledged pending answers without affecting other profiles", () => {
    const buckets = readPendingAnswerBucketsFromFallback(
      JSON.stringify({
        "profile-a": {
          [normalizeQuestionKey("Why this role?")]: {
            question: "Why this role?",
            value: "Impact",
            updatedAt: 1,
          },
        },
        "profile-b": {
          [normalizeQuestionKey("Can you relocate?")]: {
            question: "Can you relocate?",
            value: "Yes",
            updatedAt: 2,
          },
        },
      })
    );

    removePendingAnswers(buckets, "profile-a", ["Why this role?"]);

    expect(getPendingAnswersForProfile(buckets, "profile-a")).toEqual({});
    expect(
      getPendingAnswersForProfile(buckets, "profile-b")[
        normalizeQuestionKey("Can you relocate?")
      ]?.value
    ).toBe("Yes");
  });

  it("does not let older pending answers overwrite newer saved answers", () => {
    const merged = mergeSavedAnswerRecords(
      {
        [normalizeQuestionKey("Why this role?")]: {
          question: "Why this role?",
          value: "Newer saved answer",
          updatedAt: 10,
        },
      },
      {
        [normalizeQuestionKey("Why this role?")]: {
          question: "Why this role?",
          value: "Older pending answer",
          updatedAt: 1,
        },
      }
    );

    expect(merged[normalizeQuestionKey("Why this role?")]?.value).toBe(
      "Newer saved answer"
    );
  });

  it("keeps explicitly scoped pending answers parked when their profile no longer exists", () => {
    expect(
      resolvePendingAnswerTargetProfileId(
        {
          "profile-b": {
            id: "profile-b",
          },
        },
        "profile-b",
        "profile-a"
      )
    ).toBeNull();
  });

  it("falls back to the active profile for unscoped pending answers", () => {
    expect(
      resolvePendingAnswerTargetProfileId(
        {
          "profile-b": {
            id: "profile-b",
          },
        },
        "profile-b",
        undefined
      )
    ).toBe("profile-b");
  });
});
