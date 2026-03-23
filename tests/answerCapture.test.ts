// Note: describe, expect, it are provided globally by vitest (globals: true)

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

  it("does not depend on a global Element constructor to capture custom choices", () => {
    document.body.innerHTML = `
      <fieldset>
        <legend>Are you legally authorized to work in the United States?</legend>
        <button type="button" role="radio" aria-checked="true">Yes</button>
      </fieldset>
    `;

    const button = document.querySelector<HTMLElement>("button");
    expect(button).not.toBeNull();

    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "Element");
    delete (globalThis as Record<string, unknown>).Element;

    try {
      expect(findRememberableChoiceTarget(button)).toBe(button);
      expect(readChoiceAnswerForMemory(button as HTMLElement)).toEqual({
        question: "Are you legally authorized to work in the United States?",
        value: "Yes",
      });
    } finally {
      if (descriptor) {
        Object.defineProperty(globalThis, "Element", descriptor);
      }
    }
  });
});
