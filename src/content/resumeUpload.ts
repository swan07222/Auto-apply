import {
  AutomationSettings,
  ResumeAsset,
  ResumeKind,
  inferResumeKindFromTitle,
} from "../shared";
import { getFieldDescriptor, getQuestionText } from "./autofill";
import { getActionText, isElementVisible } from "./dom";
import { cleanText, normalizeChoiceText } from "./text";

export function getSelectedFileName(input: HTMLInputElement): string {
  const fileName = input.files?.[0]?.name?.trim();
  if (fileName) {
    return fileName;
  }

  const value = input.value.trim();
  if (!value) {
    return "";
  }

  const lastSlashIndex = Math.max(value.lastIndexOf("\\"), value.lastIndexOf("/"));
  return lastSlashIndex >= 0 ? value.slice(lastSlashIndex + 1).trim() : value;
}

export function shouldAttemptResumeUpload(
  input: HTMLInputElement,
  assetName: string,
  lastAttemptAt: number | null,
  now: number = Date.now(),
  cooldownMs: number = 20_000,
  alreadyUploadedByExtension = false
): boolean {
  if (input.disabled) {
    return false;
  }

  if (lastAttemptAt !== null && now - lastAttemptAt < cooldownMs) {
    return false;
  }

  const currentFileName = normalizeFileName(getSelectedFileName(input));
  const desiredFileName = normalizeFileName(assetName);

  if (
    alreadyUploadedByExtension &&
    currentFileName &&
    desiredFileName &&
    currentFileName === desiredFileName
  ) {
    return false;
  }

  return true;
}

export function hasSelectedMatchingFile(
  input: HTMLInputElement,
  assetName: string
): boolean {
  const selected = normalizeFileName(getSelectedFileName(input));
  const desired = normalizeFileName(assetName);

  return Boolean(selected && desired && selected === desired);
}

export function getResumeAssetUploadKey(
  asset: Pick<ResumeAsset, "name" | "size" | "updatedAt">
): string {
  return [
    normalizeFileName(asset.name),
    String(Math.max(0, Math.round(asset.size))),
    String(Math.max(0, Math.round(asset.updatedAt))),
  ].join(":");
}

function normalizeFileName(value: string): string {
  return value.trim().toLowerCase();
}

export function scoreResumeFileInputPreference(
  input: HTMLInputElement,
  count: number
): number {
  const descriptor = normalizeChoiceText(
    getFieldDescriptor(input, getQuestionText(input))
  );
  const directMetadata = normalizeChoiceText(
    cleanText(
      [
        descriptor,
        input.getAttribute("aria-label"),
        input.getAttribute("title"),
        input.getAttribute("placeholder"),
        input.name,
        input.id,
        input.className,
        input.accept,
      ]
        .filter(Boolean)
        .join(" ")
    )
  );
  const surroundingText = normalizeChoiceText(
    cleanText(
      input.closest("label, fieldset, section, article, form, div")?.textContent
    ).slice(0, 600)
  );
  const context = `${directMetadata} ${surroundingText}`.trim();

  if (!context) {
    return count === 1 ? 8 : 0;
  }

  const strongResumeSignals = [
    "resume",
    "resume cv",
    "upload resume",
    "attach resume",
    "resume selection",
    "add a resume for the employer",
    "curriculum vitae",
  ];
  const weakResumeSignals = ["cv", "document", "attachment", "upload", "file"];
  const negativeSignals = [
    "cover letter",
    "motivation letter",
    "personal statement",
    "transcript",
    "portfolio",
    "work sample",
    "writing sample",
    "certificate",
    "certification",
    "letter of recommendation",
    "recommendation",
    "supporting document",
    "additional document",
    "additional attachment",
  ];

  const hasDirectNegativeSignal = negativeSignals.some((signal) =>
    directMetadata.includes(signal)
  );
  const hasSurroundingNegativeSignal = negativeSignals.some((signal) =>
    surroundingText.includes(signal)
  );
  const hasDirectResumeSignal = strongResumeSignals.some((signal) =>
    directMetadata.includes(signal)
  );

  if (
    hasDirectNegativeSignal ||
    (hasSurroundingNegativeSignal && !hasDirectResumeSignal)
  ) {
    return -60;
  }

  let score = 0;

  if (
    strongResumeSignals.some(
      (signal) =>
        directMetadata.includes(signal) || surroundingText.includes(signal)
    )
  ) {
    score += 90;
  }

  if (
    weakResumeSignals.some((signal) => directMetadata.includes(signal)) &&
    !context.includes("cover")
  ) {
    score += count === 1 ? 24 : 10;
  }

  if (input.accept.toLowerCase().includes("pdf")) {
    score += 6;
  }

  if (
    input.name.toLowerCase().includes("resume") ||
    input.id.toLowerCase().includes("resume")
  ) {
    score += 28;
  }

  if (
    score <= 0 &&
    negativeSignals.some((signal) => surroundingText.includes(signal))
  ) {
    score -= 40;
  }

  if (count === 1 && score > -20) {
    score += 10;
  }

  return score;
}

export function inferResumeKindFromLabel(
  label: string | undefined
): ResumeKind | undefined {
  const normalizedLabel = label?.trim().toLowerCase() ?? "";
  if (!normalizedLabel) {
    return undefined;
  }

  if (/\b(front\s*end|frontend)\b/.test(normalizedLabel)) {
    return "front_end";
  }

  if (/\b(back\s*end|backend)\b/.test(normalizedLabel)) {
    return "back_end";
  }

  if (/\b(full\s*stack|fullstack)\b/.test(normalizedLabel)) {
    return "full_stack";
  }

  return undefined;
}

export function resolveResumeKindForJob(options: {
  preferredResumeKind?: ResumeKind;
  label?: string;
  jobTitle?: string;
}): ResumeKind | undefined {
  const { preferredResumeKind, label, jobTitle } = options;

  return (
    preferredResumeKind ??
    inferResumeKindFromLabel(label) ??
    (jobTitle ? inferResumeKindFromTitle(jobTitle) : undefined)
  );
}

export function pickResumeAssetForUpload(
  settings: Pick<AutomationSettings, "resume" | "resumes">,
  desiredResumeKind?: ResumeKind
): ResumeAsset | null {
  if (settings.resume) {
    return settings.resume;
  }

  if (desiredResumeKind) {
    for (const kind of getResumeFallbackOrder(desiredResumeKind)) {
      const asset = settings.resumes[kind];
      if (asset) {
        return asset;
      }
    }
    return null;
  }

  const available = (["full_stack", "front_end", "back_end"] as ResumeKind[])
    .map((kind) => settings.resumes[kind] ?? null)
    .filter((asset): asset is ResumeAsset => Boolean(asset))
    .sort(
      (left, right) =>
        right.updatedAt - left.updatedAt ||
        left.name.localeCompare(right.name)
    );

  return available[0] ?? null;
}

function getResumeFallbackOrder(
  desiredResumeKind: ResumeKind
): ResumeKind[] {
  switch (desiredResumeKind) {
    case "front_end":
      return ["front_end", "full_stack", "back_end"];
    case "back_end":
      return ["back_end", "full_stack", "front_end"];
    case "full_stack":
      return ["full_stack", "front_end", "back_end"];
  }
}

export function shouldUseFileInputForResume(
  input: HTMLInputElement,
  count: number
): boolean {
  return scoreResumeFileInputPreference(input, count) > 0;
}

export function isLikelyCoverLetterFileInput(
  input: HTMLInputElement
): boolean {
  const context = normalizeChoiceText(
    cleanText(
      [
        getFieldDescriptor(input, getQuestionText(input)),
        input.getAttribute("aria-label"),
        input.getAttribute("title"),
        input.getAttribute("placeholder"),
        input.name,
        input.id,
        input.className,
        input.closest("label, fieldset, section, article, form, div")?.textContent,
      ]
        .filter(Boolean)
        .join(" ")
    ).slice(0, 800)
  );

  if (!context) {
    return false;
  }

  return (
    context.includes("cover letter") ||
    context.includes("upload your cover letter") ||
    context.includes("motivation letter") ||
    context.includes("personal statement")
  );
}

export function findDiceUploadPanel(
  kind: "resume" | "cover_letter",
  root: ParentNode = document
): HTMLElement | null {
  const candidates = Array.from(
    root.querySelectorAll<HTMLElement>("section, article, div, li")
  );

  let best:
    | {
        element: HTMLElement;
        score: number;
      }
    | undefined;

  for (const candidate of candidates) {
    if (!isElementVisible(candidate)) {
      continue;
    }

    const text = normalizeChoiceText(cleanText(candidate.textContent).slice(0, 800));
    if (!text) {
      continue;
    }

    let score = 0;

    if (kind === "resume") {
      if (text.includes("resume")) score += 80;
      if (text.includes("upload your resume")) score += 65;
      if (text.includes("uploaded to application")) score += 60;
      if (text.includes("uploaded to profile")) score += 55;
      if (text.includes("cover letter")) score -= 120;
      if (text.includes("upload your cover letter")) score -= 120;
    } else {
      if (text.includes("cover letter")) score += 90;
      if (text.includes("upload your cover letter")) score += 70;
      if (text.includes("optional")) score += 15;
      if (text.includes("resume")) score -= 120;
      if (text.includes("upload your resume")) score -= 120;
    }

    if (
      text.includes(".pdf") ||
      text.includes(".doc") ||
      text.includes(".docx") ||
      text.includes("uploaded to application") ||
      text.includes("uploaded to profile")
    ) {
      score += 25;
    }

    score -= Math.min(Math.floor(text.length / 120), 12);

    if (score <= 0) {
      continue;
    }

    if (!best || score > best.score) {
      best = {
        element: candidate,
        score,
      };
    }
  }

  return best?.element ?? null;
}

export function findDiceResumePanel(
  root: ParentNode = document
): HTMLElement | null {
  return findDiceUploadPanel("resume", root);
}

export function findDiceResumeMenuButton(
  panel: ParentNode
): HTMLElement | null {
  const buttons = Array.from(
    panel.querySelectorAll<HTMLElement>("button, [role='button']")
  ).filter((button) => isElementVisible(button));

  let best:
    | {
        element: HTMLElement;
        score: number;
      }
    | undefined;

  for (const button of buttons) {
    const rect = button.getBoundingClientRect();
    const panelRect =
      panel instanceof HTMLElement ? panel.getBoundingClientRect() : null;
    const metadata = normalizeChoiceText(
      cleanText(
        [
          getActionText(button),
          button.getAttribute("aria-label"),
          button.getAttribute("title"),
          button.className,
          button.getAttribute("data-testid"),
          button.getAttribute("data-test"),
          button.getAttribute("aria-haspopup"),
        ]
          .filter(Boolean)
          .join(" ")
      )
    );

    let score = 0;

    if (
      metadata.includes("more") ||
      metadata.includes("options") ||
      metadata.includes("actions") ||
      metadata.includes("menu") ||
      metadata.includes("ellipsis") ||
      metadata.includes("kebab")
    ) {
      score += 70;
    }
    if (
      metadata.includes("haspopup") ||
      button.getAttribute("aria-haspopup") === "menu"
    ) {
      score += 30;
    }
    if (
      metadata === "" ||
      metadata === "..." ||
      metadata === "…" ||
      metadata === "⋯"
    ) {
      score += 18;
    }
    if (
      metadata.includes("replace") ||
      metadata.includes("remove") ||
      metadata.includes("delete") ||
      metadata.includes("download")
    ) {
      score -= 20;
    }

    if (score <= 0) {
      continue;
    }

    if (!best || score > best.score) {
      best = {
        element: button,
        score,
      };
    }
  }

  return best?.element ?? null;
}

export function findPreferredDiceResumeMenuButton(
  panel: ParentNode
): HTMLElement | null {
  const buttons = Array.from(
    panel.querySelectorAll<HTMLElement>("button, [role='button']")
  ).filter((button) => isElementVisible(button));

  let best:
    | {
        element: HTMLElement;
        score: number;
      }
    | undefined;

  const panelRect =
    panel instanceof HTMLElement ? panel.getBoundingClientRect() : null;

  for (const button of buttons) {
    const rect = button.getBoundingClientRect();
    const metadata = normalizeChoiceText(
      cleanText(
        [
          getActionText(button),
          button.getAttribute("aria-label"),
          button.getAttribute("title"),
          button.className,
          button.getAttribute("data-testid"),
          button.getAttribute("data-test"),
          button.getAttribute("aria-haspopup"),
        ]
          .filter(Boolean)
          .join(" ")
      )
    );

    let score = 0;

    if (
      metadata.includes("more") ||
      metadata.includes("options") ||
      metadata.includes("actions") ||
      metadata.includes("menu") ||
      metadata.includes("ellipsis") ||
      metadata.includes("kebab")
    ) {
      score += 70;
    }
    if (
      metadata.includes("haspopup") ||
      button.getAttribute("aria-haspopup") === "menu"
    ) {
      score += 30;
    }
    if (!metadata || metadata === "..." || metadata === "\u2026" || metadata === "\u22ef") {
      score += 18;
    }
    if (
      metadata.includes("replace") ||
      metadata.includes("remove") ||
      metadata.includes("delete") ||
      metadata.includes("download")
    ) {
      score -= 20;
    }
    if (rect.width <= 48 && rect.height <= 48) {
      score += 18;
    }
    if (panelRect) {
      const distanceFromRight = Math.abs(panelRect.right - rect.right);
      const distanceFromTop = Math.abs(panelRect.top - rect.top);
      if (distanceFromRight <= 80) {
        score += 22;
      }
      if (distanceFromTop <= 80) {
        score += 10;
      }
    }

    if (score <= 0) {
      continue;
    }

    if (!best || score > best.score) {
      best = {
        element: button,
        score,
      };
    }
  }

  return best?.element ?? findDiceResumeMenuButton(panel);
}

export function findScopedResumeUploadContainer(
  input: HTMLInputElement
): HTMLElement | null {
  const ancestors = [
    input.parentElement,
    input.closest("label"),
    input.closest("[class*='upload']"),
    input.closest("[class*='resume']"),
    input.closest("[class*='file']"),
    input.closest("[class*='dropzone']"),
    input.closest("[data-upload]"),
    input.closest("[data-test*='upload']"),
    input.closest("[data-test*='resume']"),
    input.closest("[data-testid*='resume']"),
    input.closest("[data-testid*='upload']"),
    input.closest("section"),
    input.closest("article"),
    input.closest("fieldset"),
    input.closest("form"),
  ].filter((element): element is HTMLElement => element instanceof HTMLElement);

  let best:
    | {
        element: HTMLElement;
        score: number;
      }
    | undefined;

  for (const element of ancestors) {
    const text = normalizeChoiceText(cleanText(element.textContent).slice(0, 800));
    let score = 0;

    if (text.includes("resume")) score += 70;
    if (text.includes("upload your resume")) score += 60;
    if (text.includes("upload resume")) score += 55;
    if (text.includes("cover letter")) score -= 120;
    if (text.includes("upload your cover letter")) score -= 120;
    if (text.includes("optional")) score -= 10;
    score -= Math.min(Math.floor(text.length / 140), 10);

    if (element.matches("[class*='resume'], [data-test*='resume'], [data-testid*='resume']")) {
      score += 25;
    }
    if (element.matches("[class*='upload'], [class*='dropzone'], [data-upload]")) {
      score += 10;
    }
    if (element.tagName === "FORM") {
      score -= 35;
    }

    if (!best || score > best.score) {
      best = {
        element,
        score,
      };
    }
  }

  return best && best.score > 0 ? best.element : null;
}

export function pickResumeUploadTargets(options: {
  inputs: HTMLInputElement[];
  assetName: string;
  uploadKey: string;
  extensionManagedUploads: Pick<WeakMap<HTMLInputElement, string>, "get">;
}): {
  alreadySatisfied: HTMLInputElement | null;
  targets: HTMLInputElement[];
} {
  const { inputs, assetName, uploadKey, extensionManagedUploads } = options;
  const eligibleInputs = inputs.filter((input) => !isLikelyCoverLetterFileInput(input));

  const rankedTargets = eligibleInputs
    .map((input, index) => ({
      input,
      index,
      score: scoreResumeFileInputPreference(input, eligibleInputs.length),
    }))
    .sort(
      (left, right) =>
        right.score - left.score || left.index - right.index
    );

  const alreadySatisfiedTarget =
    rankedTargets.find(
      ({ input, score }) =>
        score > 0 &&
        (extensionManagedUploads.get(input) === uploadKey ||
          hasSelectedMatchingFile(input, assetName))
    )?.input ?? null;

  if (alreadySatisfiedTarget) {
    return {
      alreadySatisfied: alreadySatisfiedTarget,
      targets: [],
    };
  }

  const selectedResumeTarget =
    rankedTargets.find(
      ({ input, score }) => score > 0 && Boolean(getSelectedFileName(input))
    )?.input ?? null;

  if (selectedResumeTarget) {
    return {
      alreadySatisfied: null,
      targets: [selectedResumeTarget],
    };
  }

  const usable = rankedTargets
    .filter(({ input }) => shouldUseFileInputForResume(input, inputs.length))
    .map(({ input }) => input);

  return {
    alreadySatisfied: null,
    targets:
      usable.length > 0
        ? usable
        : eligibleInputs.length === 1
          ? eligibleInputs
          : [],
  };
}
