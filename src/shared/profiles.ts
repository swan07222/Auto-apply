import type {
  AutomationProfile,
  AutomationSettings,
  CandidateProfile,
  ResumeKind,
} from "./types";

export const DEFAULT_PROFILE_ID = "default-profile";
export const DEFAULT_PROFILE_NAME = "Default Profile";

export function createEmptyCandidateProfile(): CandidateProfile {
  return {
    fullName: "",
    email: "",
    phone: "",
    city: "",
    state: "",
    country: "",
    linkedinUrl: "",
    portfolioUrl: "",
    currentCompany: "",
    yearsExperience: "",
    workAuthorization: "",
    needsSponsorship: "",
    willingToRelocate: "",
  };
}

export function createAutomationProfile(
  id = DEFAULT_PROFILE_ID,
  name = DEFAULT_PROFILE_NAME,
  now = Date.now()
): AutomationProfile {
  return {
    id,
    name: readString(name) || DEFAULT_PROFILE_NAME,
    candidate: createEmptyCandidateProfile(),
    resume: null,
    answers: {},
    preferenceAnswers: {},
    updatedAt: now,
  };
}

export function getActiveAutomationProfile(
  settings: AutomationSettings
): AutomationProfile {
  return (
    settings.profiles[settings.activeProfileId] ??
    settings.profiles[Object.keys(settings.profiles)[0] ?? DEFAULT_PROFILE_ID] ??
    createAutomationProfile()
  );
}

export function resolveAutomationSettingsForProfile(
  settings: AutomationSettings,
  profileId?: string
): AutomationSettings {
  const nextProfileId =
    profileId && settings.profiles[profileId]
      ? profileId
      : settings.activeProfileId;
  const activeProfile =
    settings.profiles[nextProfileId] ?? getActiveAutomationProfile(settings);
  const derivedResume = activeProfile.resume ?? null;

  return {
    ...settings,
    activeProfileId: activeProfile.id,
    candidate: { ...activeProfile.candidate },
    resume: derivedResume,
    resumes: derivedResume ? { full_stack: derivedResume } : {},
    answers: { ...activeProfile.answers },
    preferenceAnswers: { ...activeProfile.preferenceAnswers },
  };
}

export function inferResumeKindFromTitle(title: string): ResumeKind {
  const lower = title.toLowerCase();

  const frontendPatterns = [
    /\bfront\s*end\b/,
    /\bfrontend\b/,
    /\bui\s+engineer\b/,
    /\bui\s+developer\b/,
    /\breact\b(?!native)/,
    /\bangular\b/,
    /\bvue\b(?!\.js)/,
    /\bcss\s*(engineer|developer)?\b/,
  ];

  if (frontendPatterns.some((pattern) => pattern.test(lower))) {
    return "front_end";
  }

  const backendPatterns = [
    /\bback\s*end\b/,
    /\bbackend\b/,
    /\bserver\s+(engineer|developer|side)\b/,
    /\bapi\s+(engineer|developer|architect)\b/,
    /\bplatform\s+engineer\b/,
    /\bpython\b(?!script)/,
    /\bjava\b(?!script|scripting)/,
    /\bgolang\b/,
    /\brust\b/,
    /\bnode\.?js\b/,
    /\bruby\b(?!onrails)/,
    /\brails\b/,
    /\bdjango\b/,
    /\bspring\b(?!boot)?\s*(framework)?\b/,
    /\bdata\s+engineer\b/,
    /\bml\s+engineer\b/,
    /\bmachine\s+learning\s+engineer\b/,
  ];

  if (backendPatterns.some((pattern) => pattern.test(lower))) {
    return "back_end";
  }

  return "full_stack";
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
