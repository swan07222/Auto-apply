import {
  AutomationSettings,
  ResumeAsset,
  ResumeKind,
  inferResumeKindFromTitle,
} from "../shared";

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
  cooldownMs: number = 20_000
): boolean {
  if (input.disabled) {
    return false;
  }

  if (lastAttemptAt !== null && now - lastAttemptAt < cooldownMs) {
    return false;
  }

  const currentFileName = normalizeFileName(getSelectedFileName(input));
  const desiredFileName = normalizeFileName(assetName);

  if (currentFileName && desiredFileName && currentFileName === desiredFileName) {
    return false;
  }

  return true;
}

function normalizeFileName(value: string): string {
  return value.trim().toLowerCase();
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
  settings: Pick<AutomationSettings, "resumes">,
  desiredResumeKind?: ResumeKind
): ResumeAsset | null {
  if (desiredResumeKind) {
    return settings.resumes[desiredResumeKind] ?? null;
  }

  for (const kind of [
    "full_stack",
    "front_end",
    "back_end",
  ] as ResumeKind[]) {
    if (settings.resumes[kind]) {
      return settings.resumes[kind] ?? null;
    }
  }

  return null;
}
