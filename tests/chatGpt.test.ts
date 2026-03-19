import { describe, expect, it, vi } from "vitest";

import {
  buildChatGptPrompt,
  copyTextToClipboard,
  setComposerValue,
  waitForChatGptComposer,
} from "../src/content/chatGpt";
import type { AiAnswerRequest, SavedAnswer } from "../src/shared";

function createRequest(): AiAnswerRequest {
  return {
    id: "req-1",
    createdAt: Date.now(),
    resumeKind: "front_end",
    candidate: {
      fullName: "Piotr Example",
      email: "piotr@example.com",
      phone: "555-0100",
      city: "Phoenix",
      state: "AZ",
      country: "United States",
      linkedinUrl: "https://linkedin.com/in/piotr",
      portfolioUrl: "https://piotr.dev",
      currentCompany: "Example Co",
      yearsExperience: "6",
      workAuthorization: "Yes",
      needsSponsorship: "No",
      willingToRelocate: "Yes",
    },
    resume: {
      name: "resume.pdf",
      type: "application/pdf",
      dataUrl: "data:application/pdf;base64,ZmFrZQ==",
      textContent: "Built React systems and shipped remote-first products.",
      size: 123,
      updatedAt: Date.now(),
    },
    job: {
      title: "Senior Frontend Engineer",
      company: "Acme",
      question: "Why are you interested in this role?",
      description: "Own the frontend architecture and user experience.",
      pageUrl: "https://example.com/jobs/123",
    },
  };
}

describe("content chatGpt helpers", () => {
  it("builds a prompt with resume context and remembered answers", () => {
    const request = createRequest();
    const answers: Record<string, SavedAnswer> = {
      why_role: {
        question: "Why are you interested in this role?",
        value: "I enjoy building polished frontend systems.",
        updatedAt: Date.now(),
      },
    };

    const prompt = buildChatGptPrompt(request, answers);

    expect(prompt).toContain("Question: Why are you interested in this role?");
    expect(prompt).toContain("Job title: Senior Frontend Engineer");
    expect(prompt).toContain("Company: Acme");
    expect(prompt).toContain("Resume text:");
    expect(prompt).toContain("Built React systems");
    expect(prompt).toContain("Remembered candidate answers:");
    expect(prompt).toContain("I enjoy building polished frontend systems.");
  });

  it("finds the visible ChatGPT composer", async () => {
    document.body.innerHTML = '<textarea id="prompt-textarea"></textarea>';

    const composer = await waitForChatGptComposer();

    expect(composer).toBeInstanceOf(HTMLTextAreaElement);
    expect((composer as HTMLTextAreaElement | null)?.id).toBe("prompt-textarea");
  });

  it("sets textarea composer content", async () => {
    const composer = document.createElement("textarea");
    document.body.append(composer);

    const inserted = await setComposerValue(composer, "Draft this answer.");

    expect(inserted).toBe(true);
    expect(composer.value).toBe("Draft this answer.");
  });

  it("copies text through the clipboard api when available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    const copied = await copyTextToClipboard("Copied text");

    expect(copied).toBe(true);
    expect(writeText).toHaveBeenCalledWith("Copied text");
  });
});
