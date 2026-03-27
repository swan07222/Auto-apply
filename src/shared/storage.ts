import {
  AUTOMATION_SETTINGS_STORAGE_KEY,
  DEFAULT_SETTINGS,
  isDatePostedWindow,
  MAX_JOB_PAGE_LIMIT,
  MIN_JOB_PAGE_LIMIT,
  RESUME_KIND_LABELS,
} from "./catalog";
import {
  createAutomationProfile,
  createEmptyCandidateProfile,
  DEFAULT_PROFILE_ID,
  DEFAULT_PROFILE_NAME,
  resolveAutomationSettingsForProfile,
} from "./profiles";
import type {
  AutomationProfile,
  AutomationSettings,
  CandidateProfile,
  DatePostedWindow,
  ResumeAsset,
  ResumeKind,
  SavedAnswer,
  SearchMode,
  StartupRegion,
} from "./types";

let automationSettingsWriteQueue: Promise<void> = Promise.resolve();

const BLOCKED_SAVED_ANSWER_QUESTION_KEYS = new Set([
  "on",
  "off",
  "yes",
  "no",
  "true",
  "false",
  "search",
  "keyword",
  "keywords",
  "query",
  "q",
  "what",
  "where",
  "radius",
  "distance",
  "filter",
]);

const BLOCKED_SAVED_ANSWER_QUESTION_PATTERNS = [
  /^_{1,2}[a-z0-9_:-]+$/i,
  /(?:^|[\s_-])(?:csrf|captcha|recaptcha|hcaptcha|g\s*recaptcha|requestverificationtoken|verificationtoken|authenticitytoken|viewstate|eventvalidation|xsrf|nonce)(?:$|[\s_-])/i,
  /(?:^|[\s_-])(?:distance|radius|keyword|keywords|search|query)(?:$|[\s_-])/i,
];

export function normalizeQuestionKey(question: string): string {
  return question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isUsefulSavedAnswerQuestion(question: string): boolean {
  const cleanedQuestion =
    typeof question === "string" ? question.replace(/\s+/g, " ").trim() : "";
  const normalizedQuestion = normalizeQuestionKey(cleanedQuestion);

  if (!cleanedQuestion || !normalizedQuestion) {
    return false;
  }

  if (BLOCKED_SAVED_ANSWER_QUESTION_KEYS.has(normalizedQuestion)) {
    return false;
  }

  if (
    BLOCKED_SAVED_ANSWER_QUESTION_PATTERNS.some((pattern) =>
      pattern.test(cleanedQuestion)
    )
  ) {
    return false;
  }

  const compactQuestion = cleanedQuestion.replace(/[^a-z0-9]/gi, "");
  if (
    compactQuestion.length >= 24 &&
    !/\s/.test(cleanedQuestion) &&
    /[A-Z]/.test(cleanedQuestion) &&
    /[a-z]/.test(cleanedQuestion)
  ) {
    return false;
  }

  return true;
}

export function isUsefulSavedAnswer(
  question: string,
  value: string
): boolean {
  return isUsefulSavedAnswerQuestion(question) && readString(value).length > 0;
}

export async function readAutomationSettings(): Promise<AutomationSettings> {
  const stored = await chrome.storage.local.get(AUTOMATION_SETTINGS_STORAGE_KEY);
  return sanitizeAutomationSettings(stored[AUTOMATION_SETTINGS_STORAGE_KEY]);
}

export async function writeAutomationSettings(
  update:
    | Partial<AutomationSettings>
    | AutomationSettings
    | ((current: AutomationSettings) => Partial<AutomationSettings> | AutomationSettings)
): Promise<AutomationSettings> {
  const queuedWrite = automationSettingsWriteQueue.then(async () => {
    const current = await readAutomationSettings();
    const nextRaw = typeof update === "function" ? update(current) : update;
    const sanitized = applyAutomationSettingsUpdate(current, nextRaw);
    await chrome.storage.local.set({ [AUTOMATION_SETTINGS_STORAGE_KEY]: sanitized });
    return sanitized;
  });

  automationSettingsWriteQueue = queuedWrite.then(
    () => undefined,
    () => undefined
  );

  return queuedWrite;
}

export function applyAutomationSettingsUpdate(
  current: AutomationSettings,
  update: Partial<AutomationSettings> | AutomationSettings
): AutomationSettings {
  const source = isRecord(update) ? update : {};
  const profiles =
    "profiles" in source
      ? sanitizeAutomationProfiles(source.profiles)
      : cloneAutomationProfiles(current.profiles);
  let activeProfileId =
    readString(source.activeProfileId) || current.activeProfileId;

  if (!profiles[activeProfileId]) {
    activeProfileId = Object.keys(profiles)[0] ?? DEFAULT_PROFILE_ID;
  }

  const existingProfile =
    profiles[activeProfileId] ?? createAutomationProfile(activeProfileId);
  const nextProfile: AutomationProfile = {
    ...existingProfile,
    candidate:
      "candidate" in source && isRecord(source.candidate)
        ? sanitizeCandidateProfile({
            ...existingProfile.candidate,
            ...source.candidate,
          })
        : { ...existingProfile.candidate },
    resume:
      "resume" in source
        ? sanitizeResumeAsset(source.resume) ?? null
        : "resumes" in source && isRecord(source.resumes)
          ? pickPrimaryResumeAssetFromLegacyResumes(source.resumes)
          : existingProfile.resume,
    answers:
      "answers" in source
        ? sanitizeSavedAnswerRecord(source.answers)
        : cloneSavedAnswers(existingProfile.answers),
    preferenceAnswers:
      "preferenceAnswers" in source
        ? sanitizeSavedAnswerRecord(source.preferenceAnswers)
        : cloneSavedAnswers(existingProfile.preferenceAnswers),
    updatedAt: Date.now(),
  };

  profiles[activeProfileId] = nextProfile;

  return sanitizeAutomationSettings({
    ...current,
    ...source,
    searchKeywords:
      "searchKeywords" in source
        ? sanitizeSearchKeywords(source.searchKeywords)
        : current.searchKeywords,
    activeProfileId,
    profiles,
  });
}

export function sanitizeAutomationSettings(raw: unknown): AutomationSettings {
  const source = isRecord(raw) ? raw : {};
  const profiles = sanitizeAutomationProfiles(source.profiles);
  const hasStoredProfiles = Object.keys(profiles).length > 0;
  const fallbackProfile = sanitizeLegacyProfile(source);
  const mergedProfiles = hasStoredProfiles
    ? profiles
    : {
        [fallbackProfile.id]: fallbackProfile,
      };

  let activeProfileId =
    readString(source.activeProfileId) ||
    Object.keys(mergedProfiles)[0] ||
    DEFAULT_PROFILE_ID;

  if (!mergedProfiles[activeProfileId]) {
    activeProfileId = Object.keys(mergedProfiles)[0] ?? DEFAULT_PROFILE_ID;
  }

  const baseSettings: AutomationSettings = {
    jobPageLimit: clampJobPageLimit(source.jobPageLimit),
    autoUploadResumes: true,
    searchMode: sanitizeSearchMode(source.searchMode),
    startupRegion: sanitizeStartupRegion(source.startupRegion),
    datePostedWindow: sanitizeDatePostedWindow(source.datePostedWindow),
    searchKeywords: sanitizeSearchKeywords(source.searchKeywords),
    activeProfileId,
    profiles: mergedProfiles,
    candidate: createEmptyCandidateProfile(),
    resume: null,
    resumes: {},
    answers: {},
    preferenceAnswers: {},
  };

  return resolveAutomationSettingsForProfile(baseSettings, activeProfileId);
}

function sanitizeLegacyProfile(source: Record<string, unknown>): AutomationProfile {
  const now = Date.now();
  const legacyResumes = isRecord(source.resumes) ? source.resumes : {};

  return {
    ...createAutomationProfile(DEFAULT_PROFILE_ID, DEFAULT_PROFILE_NAME, now),
    candidate: sanitizeCandidateProfile(source.candidate),
    resume: pickPrimaryResumeAssetFromLegacyResumes(legacyResumes),
    answers: sanitizeSavedAnswerRecord(source.answers),
    preferenceAnswers: sanitizeSavedAnswerRecord(source.preferenceAnswers),
    updatedAt: now,
  };
}

function sanitizeAutomationProfiles(raw: unknown): Record<string, AutomationProfile> {
  const source = isRecord(raw) ? raw : {};
  const profiles: Record<string, AutomationProfile> = {};

  for (const [rawId, value] of Object.entries(source)) {
    const id = readString(rawId);
    if (!id || !isRecord(value)) {
      continue;
    }

    profiles[id] = sanitizeAutomationProfile(id, value);
  }

  return profiles;
}

function sanitizeAutomationProfile(
  id: string,
  value: Record<string, unknown>
): AutomationProfile {
  return {
    id,
    name: readString(value.name) || DEFAULT_PROFILE_NAME,
    candidate: sanitizeCandidateProfile(value.candidate),
    resume:
      sanitizeResumeAsset(value.resume) ??
      (isRecord(value.resumes)
        ? pickPrimaryResumeAssetFromLegacyResumes(value.resumes)
        : null),
    answers: sanitizeSavedAnswerRecord(value.answers),
    preferenceAnswers: sanitizeSavedAnswerRecord(value.preferenceAnswers),
    updatedAt: Number.isFinite(value.updatedAt)
      ? Number(value.updatedAt)
      : Date.now(),
  };
}

function sanitizeCandidateProfile(value: unknown): CandidateProfile {
  const source = isRecord(value) ? value : {};

  return {
    fullName: readString(source.fullName),
    email: readString(source.email),
    phone: readString(source.phone),
    city: readString(source.city),
    state: readString(source.state),
    country: readString(source.country),
    linkedinUrl: readString(source.linkedinUrl),
    portfolioUrl: readString(source.portfolioUrl),
    currentCompany: readString(source.currentCompany),
    yearsExperience: readString(source.yearsExperience),
    workAuthorization: readString(source.workAuthorization),
    needsSponsorship: readString(source.needsSponsorship),
    willingToRelocate: readString(source.willingToRelocate),
  };
}

function sanitizeSavedAnswerRecord(raw: unknown): Record<string, SavedAnswer> {
  const source = isRecord(raw) ? raw : {};
  const answers: Record<string, SavedAnswer> = {};

  for (const [key, value] of Object.entries(source)) {
    if (!isRecord(value)) continue;
    const question = readString(value.question);
    const savedValue = readString(value.value);
    if (!isUsefulSavedAnswer(question, savedValue)) continue;
    const normalizedKey = normalizeQuestionKey(key || question);
    if (!normalizedKey) continue;
    answers[normalizedKey] = {
      question,
      value: savedValue,
      updatedAt: Number.isFinite(value.updatedAt)
        ? Number(value.updatedAt)
        : Date.now(),
    };
  }

  return answers;
}

function cloneSavedAnswers(
  answers: Record<string, SavedAnswer>
): Record<string, SavedAnswer> {
  return Object.fromEntries(
    Object.entries(answers).map(([key, value]) => [key, { ...value }])
  );
}

function cloneAutomationProfiles(
  profiles: Record<string, AutomationProfile>
): Record<string, AutomationProfile> {
  return Object.fromEntries(
    Object.entries(profiles).map(([id, profile]) => [
      id,
      {
        ...profile,
        candidate: { ...profile.candidate },
        resume: profile.resume ? { ...profile.resume } : null,
        answers: cloneSavedAnswers(profile.answers),
        preferenceAnswers: cloneSavedAnswers(profile.preferenceAnswers),
      },
    ])
  );
}

function pickPrimaryResumeAssetFromLegacyResumes(
  raw: Record<string, unknown>
): ResumeAsset | null {
  const assets = (Object.keys(RESUME_KIND_LABELS) as ResumeKind[])
    .map((key) => sanitizeResumeAsset(raw[key]))
    .filter((asset): asset is ResumeAsset => Boolean(asset))
    .sort(
      (left, right) =>
        right.updatedAt - left.updatedAt ||
        left.name.localeCompare(right.name)
    );

  return assets[0] ?? null;
}

function clampJobPageLimit(raw: unknown): number {
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return DEFAULT_SETTINGS.jobPageLimit;
  return Math.min(MAX_JOB_PAGE_LIMIT, Math.max(MIN_JOB_PAGE_LIMIT, Math.round(numeric)));
}

function sanitizeResumeAsset(value: unknown): ResumeAsset | null {
  if (!isRecord(value)) {
    return null;
  }

  const name = readString(value.name);
  const type = readString(value.type);
  const dataUrl = readString(value.dataUrl);
  const textContent = readString(value.textContent);
  const size = Number.isFinite(value.size) ? Number(value.size) : 0;
  if (!name || !type || !dataUrl) {
    return null;
  }

  return {
    name,
    type,
    dataUrl,
    textContent,
    size,
    updatedAt: Number.isFinite(value.updatedAt)
      ? Number(value.updatedAt)
      : Date.now(),
  };
}

function sanitizeSearchKeywords(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  const deduped = new Map<string, string>();

  for (const rawEntry of value.split(/[\r\n,]+/)) {
    const entry = rawEntry.trim();
    if (!entry) {
      continue;
    }

    const normalized = normalizeQuestionKey(entry);
    if (!normalized || deduped.has(normalized)) {
      continue;
    }

    deduped.set(normalized, entry);
  }

  return Array.from(deduped.values()).join("\n");
}

function sanitizeSearchMode(value: unknown): SearchMode {
  return value === "startup_careers" || value === "other_job_sites"
    ? value
    : DEFAULT_SETTINGS.searchMode;
}

function sanitizeStartupRegion(value: unknown): StartupRegion {
  return value === "us" || value === "uk" || value === "eu" || value === "auto"
    ? value
    : DEFAULT_SETTINGS.startupRegion;
}

function sanitizeDatePostedWindow(value: unknown): DatePostedWindow {
  return isDatePostedWindow(value) ? value : DEFAULT_SETTINGS.datePostedWindow;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
