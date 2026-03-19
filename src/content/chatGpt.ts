import {
  AiAnswerRequest,
  SavedAnswer,
  getResumeKindLabel,
  sleep,
} from "../shared";
import { getRelevantSavedAnswers } from "./answerMemory";
import { setFieldValue } from "./autofill";
import { findFirstVisibleElement, isElementVisible } from "./dom";
import { cleanText, normalizeChoiceText, truncateText } from "./text";

export async function waitForChatGptComposer(): Promise<HTMLElement | null> {
  for (let i = 0; i < 50; i += 1) {
    const composer = findFirstVisibleElement<HTMLElement>([
      "#prompt-textarea",
      "textarea[data-testid*='prompt']",
      "form textarea",
      "div[contenteditable='true'][role='textbox']",
      "[contenteditable='true'][data-placeholder]",
    ]);
    if (composer) {
      return composer;
    }

    await sleep(800);
  }

  return null;
}

export async function setComposerValue(
  composer: HTMLElement,
  prompt: string
): Promise<boolean> {
  if (composer instanceof HTMLTextAreaElement) {
    composer.focus();
    composer.dispatchEvent(
      new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        data: prompt,
        inputType: "insertText",
      })
    );
    setFieldValue(composer, prompt);
    composer.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        data: prompt,
        inputType: "insertText",
      })
    );

    return waitForChatGptComposerText(composer, prompt, 1_500);
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    composer.focus();
    clearChatGptComposer(composer);
    composer.dispatchEvent(
      new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        data: prompt,
        inputType: "insertText",
      })
    );

    const insertedWithCommand = tryInsertComposerTextWithCommand(
      composer,
      prompt
    );
    if (!insertedWithCommand) {
      writeComposerTextFallback(composer, prompt);
    }

    composer.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        data: prompt,
        inputType: "insertFromPaste",
      })
    );

    if (await waitForChatGptComposerText(composer, prompt, 1_200)) {
      return true;
    }
  }

  return false;
}

export function buildChatGptPrompt(
  request: AiAnswerRequest,
  availableAnswers: Record<string, SavedAnswer>
): string {
  const resumeKindNote = request.resumeKind
    ? `Selected resume track: ${getResumeKindLabel(request.resumeKind)}.`
    : "Selected resume track: Not specified.";
  const resumeNote = request.resume?.textContent
    ? "Resume context below was extracted locally from the selected resume file. Use that text as the primary source of candidate history and skills."
    : request.resume
      ? "A resume file was selected locally, but no extracted resume text is available. Use the candidate profile and job description only."
      : "No resume file is attached.";
  const rememberedAnswers = getRelevantSavedAnswers(
    request.job.question,
    availableAnswers
  );
  const resumeTextBlock = request.resume?.textContent
    ? [
        "",
        "Resume text:",
        truncateText(request.resume.textContent, 12_000),
      ]
    : [];
  const companyLine = request.job.company
    ? `Company: ${request.job.company}`
    : "Company: Unknown";

  const rememberedAnswerBlock =
    rememberedAnswers.length > 0
      ? [
          "",
          "Remembered candidate answers:",
          ...rememberedAnswers.map(
            (answer) =>
              `- ${truncateText(answer.question, 90)}: ${truncateText(answer.value, 220)}`
          ),
          "Reuse any matching remembered answer when it directly fits the question.",
        ]
      : [];

  return [
    "Write a polished, job-application-ready answer.",
    "Return only final answer text, no preface, no placeholders.",
    "",
    `Question: ${request.job.question}`,
    `Job title: ${request.job.title || "Unknown"}`,
    companyLine,
    `Job page: ${request.job.pageUrl}`,
    "",
    "Candidate profile:",
    `Name: ${request.candidate.fullName || "N/A"}`,
    `Email: ${request.candidate.email || "N/A"}`,
    `Phone: ${request.candidate.phone || "N/A"}`,
    `Location: ${
      [
        request.candidate.city,
        request.candidate.state,
        request.candidate.country,
      ]
        .filter(Boolean)
        .join(", ") || "N/A"
    }`,
    `LinkedIn: ${request.candidate.linkedinUrl || "N/A"}`,
    `Portfolio: ${request.candidate.portfolioUrl || "N/A"}`,
    `Current company: ${request.candidate.currentCompany || "N/A"}`,
    `Experience: ${request.candidate.yearsExperience || "N/A"}`,
    `Work authorization: ${request.candidate.workAuthorization || "N/A"}`,
    `Sponsorship: ${request.candidate.needsSponsorship || "N/A"}`,
    `Relocate: ${request.candidate.willingToRelocate || "N/A"}`,
    "",
    resumeKindNote,
    resumeNote,
    ...resumeTextBlock,
    ...rememberedAnswerBlock,
    "",
    "Job description:",
    request.job.description || "No description found.",
    "",
    "Keep concise, specific to this role, ready to paste.",
  ].join("\n");
}

export async function submitChatGptPrompt(
  composer: HTMLElement,
  prompt: string
): Promise<void> {
  const priorUserText = getLatestChatGptUserText();
  const sendButton = await waitForChatGptReadyToSend(composer);

  if (sendButton && !sendButton.disabled) {
    sendButton.click();
    if (
      await waitForChatGptPromptAcceptance(prompt, priorUserText, 6_000)
    ) {
      return;
    }
  }

  const form = composer.closest("form");
  if (form?.requestSubmit) {
    form.requestSubmit();
    if (
      await waitForChatGptPromptAcceptance(prompt, priorUserText, 5_000)
    ) {
      return;
    }
  }

  if (form) {
    form.dispatchEvent(
      new Event("submit", {
        bubbles: true,
        cancelable: true,
      })
    );
    if (
      await waitForChatGptPromptAcceptance(prompt, priorUserText, 5_000)
    ) {
      return;
    }
  }

  composer.focus();
  for (const eventType of ["keydown", "keypress", "keyup"] as const) {
    composer.dispatchEvent(
      new KeyboardEvent(eventType, {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
      })
    );
  }

  if (
    await waitForChatGptPromptAcceptance(prompt, priorUserText, 5_000)
  ) {
    return;
  }

  throw new Error("ChatGPT prompt was not submitted.");
}

export async function waitForChatGptAnswerText(): Promise<string | null> {
  let lastText = "";
  let stableCount = 0;

  for (let i = 0; i < 150; i += 1) {
    const text = getLatestChatGptAssistantText();
    const generating = hasActiveChatGptGeneration();

    if (text && text === lastText) {
      stableCount += 1;
    } else if (text) {
      lastText = text;
      stableCount = 1;
    }

    if (text && !generating && stableCount >= 4) {
      return text;
    }

    await sleep(1_200);
  }

  return lastText || null;
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Ignore clipboard API failures and fall back.
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  } catch {
    return false;
  }
}

async function waitForChatGptSendButton(
  composer?: HTMLElement
): Promise<HTMLButtonElement | null> {
  for (let i = 0; i < 35; i += 1) {
    const button =
      findChatGptSendButton(composer) ??
      findFirstVisibleElement<HTMLButtonElement>([
        "button[data-testid='send-button']",
        "button[data-testid*='send']",
        "button[aria-label*='Send']",
        "button[aria-label*='Submit']",
        "button[type='submit']",
      ]);
    if (button) {
      return button;
    }

    await sleep(800);
  }

  return null;
}

function clearChatGptComposer(composer: HTMLElement): void {
  if (composer instanceof HTMLTextAreaElement) {
    setFieldValue(composer, "");
    return;
  }

  composer.focus();
  const selection = window.getSelection();
  if (selection) {
    const range = document.createRange();
    range.selectNodeContents(composer);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  try {
    document.execCommand("selectAll", false);
    document.execCommand("delete", false);
  } catch {
    // Ignore command failures.
  }

  composer.replaceChildren();
  composer.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      data: "",
      inputType: "deleteContentBackward",
    })
  );
}

function tryInsertComposerTextWithCommand(
  composer: HTMLElement,
  prompt: string
): boolean {
  composer.focus();

  try {
    return document.execCommand("insertText", false, prompt);
  } catch {
    return false;
  }
}

function writeComposerTextFallback(
  composer: HTMLElement,
  prompt: string
): void {
  const fragment = document.createDocumentFragment();
  const lines = prompt.split("\n");

  if (lines.length <= 1) {
    composer.replaceChildren(document.createTextNode(prompt));
    return;
  }

  for (const line of lines) {
    const paragraph = document.createElement("p");
    if (line) {
      paragraph.textContent = line;
    } else {
      paragraph.append(document.createElement("br"));
    }
    fragment.append(paragraph);
  }

  composer.replaceChildren(fragment);
}

async function waitForChatGptComposerText(
  composer: HTMLElement,
  prompt: string,
  timeoutMs: number
): Promise<boolean> {
  const expected = normalizeChoiceText(prompt).slice(0, 120);
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const actual = normalizeChoiceText(
      composer instanceof HTMLTextAreaElement
        ? composer.value
        : cleanText(composer.innerText || composer.textContent || "")
    );

    if (
      actual &&
      (actual.includes(expected) ||
        expected.includes(actual.slice(0, 60)))
    ) {
      return true;
    }

    await sleep(120);
  }

  return false;
}

async function waitForChatGptReadyToSend(
  composer: HTMLElement
): Promise<HTMLButtonElement | null> {
  const start = Date.now();

  while (Date.now() - start < 6_000) {
    const button = findChatGptSendButton(composer);
    if (button && !button.disabled) {
      return button;
    }

    await sleep(250);
  }

  return waitForChatGptSendButton(composer);
}

function findChatGptSendButton(
  composer?: HTMLElement
): HTMLButtonElement | null {
  const form = (composer?.closest("form") ?? null) as HTMLFormElement | null;
  const buttons = [
    ...(form ? Array.from(form.querySelectorAll<HTMLButtonElement>("button")) : []),
    ...Array.from(document.querySelectorAll<HTMLButtonElement>("button")),
  ];
  const seen = new Set<HTMLButtonElement>();

  for (const button of buttons) {
    if (seen.has(button)) {
      continue;
    }
    seen.add(button);

    if (
      !isElementVisible(button) ||
      button.disabled ||
      !isProbablyChatGptSendButton(button, form)
    ) {
      continue;
    }

    return button;
  }

  return null;
}

function isProbablyChatGptSendButton(
  button: HTMLButtonElement,
  form: HTMLFormElement | null
): boolean {
  const label = cleanText(
    [
      button.getAttribute("aria-label"),
      button.getAttribute("title"),
      button.getAttribute("data-testid"),
      button.textContent,
    ].join(" ")
  ).toLowerCase();

  if (
    label.includes("stop") ||
    label.includes("voice") ||
    label.includes("microphone") ||
    label.includes("attach") ||
    label.includes("upload") ||
    label.includes("plus")
  ) {
    return false;
  }

  if (label.includes("send") || label.includes("submit")) {
    return true;
  }

  if (button.type.toLowerCase() === "submit") {
    return true;
  }

  if (form && button.closest("form") === form) {
    const hasIconOnlyMarkup = Boolean(button.querySelector("svg, path"));
    return hasIconOnlyMarkup && !label;
  }

  return false;
}

async function waitForChatGptPromptAcceptance(
  prompt: string,
  priorUserText: string,
  timeoutMs: number
): Promise<boolean> {
  const expected = normalizeChoiceText(prompt);
  const expectedPrefix = expected.slice(0, 120);
  const prior = normalizeChoiceText(priorUserText);
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    if (hasActiveChatGptGeneration()) {
      return true;
    }

    const latestUserText = normalizeChoiceText(getLatestChatGptUserText());
    if (
      latestUserText &&
      latestUserText !== prior &&
      (latestUserText.includes(expectedPrefix) ||
        expectedPrefix.includes(latestUserText.slice(0, 60)))
    ) {
      return true;
    }

    await sleep(250);
  }

  return false;
}

function getLatestChatGptUserText(): string {
  const messages = Array.from(
    document.querySelectorAll<HTMLElement>("[data-message-author-role='user']")
  );
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const text = readChatGptMsgText(messages[i]);
    if (text.length > 10) {
      return text;
    }
  }

  const turns = Array.from(
    document.querySelectorAll<HTMLElement>(
      "article, [data-testid*='conversation-turn']"
    )
  );
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const element = turns[i];
    const author = cleanText(
      element.getAttribute("data-message-author-role") ||
        element
          .querySelector<HTMLElement>("[data-message-author-role]")
          ?.getAttribute("data-message-author-role") ||
        ""
    ).toLowerCase();
    const text = readChatGptMsgText(element);
    if (author === "user" && text.length > 10) {
      return text;
    }
  }

  return "";
}

function getLatestChatGptAssistantText(): string {
  const messages = Array.from(
    document.querySelectorAll<HTMLElement>(
      "[data-message-author-role='assistant']"
    )
  );
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const text = readChatGptMsgText(messages[i]);
    if (text.length > 20) {
      return text;
    }
  }

  const turns = Array.from(
    document.querySelectorAll<HTMLElement>(
      "article, [data-testid*='conversation-turn']"
    )
  );
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const element = turns[i];
    const author = cleanText(
      element.getAttribute("data-message-author-role") ||
        element
          .querySelector<HTMLElement>("[data-message-author-role]")
          ?.getAttribute("data-message-author-role") ||
        ""
    ).toLowerCase();
    const text = readChatGptMsgText(element);
    if (author === "assistant" && text.length > 20) {
      return text;
    }

    if (!author && text.length > 80 && element.querySelector(".markdown, p, li, pre")) {
      return text;
    }
  }

  return "";
}

function hasActiveChatGptGeneration(): boolean {
  return Array.from(
    document.querySelectorAll<HTMLElement>("button, [role='button']")
  ).some((element) => {
    const label = cleanText(
      [
        element.getAttribute("aria-label"),
        element.getAttribute("data-testid"),
        element.textContent,
      ].join(" ")
    ).toLowerCase();
    return (
      label.includes("stop generating") ||
      label.includes("stop streaming") ||
      label.includes("stop response") ||
      label.includes("stop")
    );
  });
}

function readChatGptMsgText(container: HTMLElement): string {
  const node =
    container.querySelector<HTMLElement>(".markdown, [class*='markdown']") ??
    container;
  return cleanText(node.innerText || node.textContent || "");
}
