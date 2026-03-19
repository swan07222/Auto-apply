import { describe, expect, it } from "vitest";

import {
  findRememberableChoiceTarget,
  readChoiceAnswerForMemory,
} from "../src/content/answerCapture";

describe("answer capture helpers", () => {
  it("captures question and value from custom choice buttons", () => {
    document.body.innerHTML = `
      <fieldset>
        <legend>Are you legally authorized to work in the United States?</legend>
        <button type="button" role="radio" aria-checked="true">Yes</button>
        <button type="button" role="radio" aria-checked="false">No</button>
      </fieldset>
    `;

    const button = document.querySelector<HTMLElement>("button[aria-checked='true']");
    expect(button).not.toBeNull();

    expect(findRememberableChoiceTarget(button)).toBe(button);
    expect(readChoiceAnswerForMemory(button as HTMLElement)).toEqual({
      question: "Are you legally authorized to work in the United States?",
      value: "Yes",
    });
  });

  it("ignores progression buttons so they are not remembered as answers", () => {
    document.body.innerHTML = `
      <section role="dialog" aria-modal="true">
        <p>Upload your resume and continue your application</p>
        <button data-test="continue-button">Continue</button>
      </section>
    `;

    const button = document.querySelector<HTMLElement>("button");
    expect(button).not.toBeNull();
    expect(findRememberableChoiceTarget(button)).toBeNull();
  });
});
