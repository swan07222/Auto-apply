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
