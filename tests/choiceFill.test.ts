// Note: describe, expect, it are provided globally by vitest (globals: true)
// vi must be imported for mocking
import { vi } from "vitest";

import {
  applyAnswerToRadioGroup,
  selectOptionByAnswer,
} from "../src/content/choiceFill";

describe("choice fill helpers", () => {
  it("can override a preselected radio choice when allowed", () => {
    document.body.innerHTML = `
      <form>
        <label for="auth-no">No</label>
        <input id="auth-no" name="authorized" type="radio" value="no" checked />
        <label for="auth-yes">Yes</label>
        <input id="auth-yes" name="authorized" type="radio" value="yes" />
      </form>
    `;

    const no = document.querySelector("#auth-no") as HTMLInputElement;
    const yes = document.querySelector("#auth-yes") as HTMLInputElement;
    const inputSpy = vi.fn();
    const changeSpy = vi.fn();

    yes.addEventListener("input", inputSpy);
    yes.addEventListener("change", changeSpy);

    expect(applyAnswerToRadioGroup(no, "Yes", true)).toBe(true);
    expect(yes.checked).toBe(true);
    expect(no.checked).toBe(false);
    expect(inputSpy).toHaveBeenCalledTimes(1);
    expect(changeSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps an existing radio choice when overwrite is not allowed", () => {
    document.body.innerHTML = `
      <form>
        <label for="sponsor-no">No</label>
        <input id="sponsor-no" name="sponsorship" type="radio" value="no" checked />
        <label for="sponsor-yes">Yes</label>
        <input id="sponsor-yes" name="sponsorship" type="radio" value="yes" />
      </form>
    `;

    const no = document.querySelector("#sponsor-no") as HTMLInputElement;
    const yes = document.querySelector("#sponsor-yes") as HTMLInputElement;

    expect(applyAnswerToRadioGroup(no, "Yes", false)).toBe(false);
    expect(no.checked).toBe(true);
    expect(yes.checked).toBe(false);
  });

  it("selects the matching option by answer text", () => {
    document.body.innerHTML = `
      <label for="authorization">Authorization</label>
      <select id="authorization">
        <option value="">Select one</option>
        <option value="citizen">US Citizen</option>
        <option value="visa">Needs sponsorship</option>
      </select>
    `;

    const select = document.querySelector("#authorization") as HTMLSelectElement;
    const inputSpy = vi.fn();
    const changeSpy = vi.fn();

    select.addEventListener("input", inputSpy);
    select.addEventListener("change", changeSpy);

    expect(selectOptionByAnswer(select, "US Citizen")).toBe(true);
    expect(select.value).toBe("citizen");
    expect(inputSpy).toHaveBeenCalledTimes(1);
    expect(changeSpy).toHaveBeenCalledTimes(1);
  });
});
