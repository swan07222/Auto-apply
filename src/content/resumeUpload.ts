import {
  AutomationSettings,
  ResumeAsset,
  ResumeKind,
  inferResumeKindFromTitle,
} from "../shared";
import { getFieldDescriptor, getQuestionText } from "./autofill";
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
