import type {
  AutomationSession,
  AutomationStage,
  SiteKey,
  SpawnTabRequest,
} from "../shared";

export type ManagedSessionCompletionKind =
  | "successful"
  | "released"
  | "handoff";

export function isFrameBoundSession(session: AutomationSession): boolean {
  return session.stage === "autofill-form" && session.site !== "unsupported";
}

export async function resolveContentReadySession(
  session: AutomationSession,
  senderFrameId: number,
  looksLikeApplicationSurface: boolean,
  persistSession: (session: AutomationSession) => Promise<void>
): Promise<{ session: AutomationSession; shouldResume: boolean }> {
  if (!isFrameBoundSession(session)) {
    return {
      session,
      shouldResume: Boolean(session.shouldResume),
    };
  }

  if (typeof session.controllerFrameId === "number") {
    return {
      session,
      shouldResume:
        session.controllerFrameId === senderFrameId &&
        Boolean(session.shouldResume),
    };
  }

  if (!looksLikeApplicationSurface) {
    return {
      session,
      shouldResume: false,
    };
  }

  const claimedSession: AutomationSession = {
    ...session,
    controllerFrameId: senderFrameId,
  };
  await persistSession(claimedSession);

  return {
    session: claimedSession,
    shouldResume: Boolean(claimedSession.shouldResume),
  };
}

export function isManagedJobStage(
  stage: AutomationStage | undefined
): stage is "open-apply" | "autofill-form" {
  return stage === "open-apply" || stage === "autofill-form";
}

export function shouldQueueManagedJobSession(
  item: SpawnTabRequest,
  sourceSession: AutomationSession | null
): boolean {
  if (!item.runId || !isManagedJobStage(item.stage)) {
    return false;
  }

  if (sourceSession?.stage === "collect-results") {
    return false;
  }

  if (
    sourceSession?.runId === item.runId &&
    isManagedJobSession(sourceSession)
  ) {
    return false;
  }

  return true;
}

export function isManagedJobSession(session: AutomationSession): boolean {
  return Boolean(session.runId && isManagedJobStage(session.stage));
}

export function isManagedJobSessionActive(
  session: AutomationSession
): boolean {
  return (
    isManagedJobSession(session) &&
    session.shouldResume &&
    (session.phase === "running" ||
      session.phase === "waiting_for_verification")
  );
}

export function isManagedJobSessionPending(
  session: AutomationSession
): boolean {
  return (
    isManagedJobSession(session) &&
    !session.shouldResume &&
    session.phase !== "completed" &&
    session.phase !== "error"
  );
}

export function isRateLimitMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes("rate limited") || lower.includes("rate limit exceeded");
}

export function isRateLimitedSession(session: AutomationSession): boolean {
  return session.phase === "error" && isRateLimitMessage(session.message);
}

export function isSuccessfulJobCompletion(
  session: AutomationSession,
  completionKind?: ManagedSessionCompletionKind
): boolean {
  if (!isManagedJobSession(session) || session.phase !== "completed") {
    return false;
  }

  if (completionKind) {
    return completionKind === "successful";
  }

  const message = session.message.toLowerCase();

  return (
    message.includes("review before submitting") ||
    message.includes("application opened. no fields auto-filled") ||
    message.includes("application opened, nothing auto-filled") ||
    message.includes("application page opened. review and complete manually") ||
    message.includes("review manually")
  );
}

export function shouldReleaseManagedJobOpening(
  session: AutomationSession,
  completionKind?: ManagedSessionCompletionKind
): boolean {
  if (!isManagedJobSession(session)) {
    return false;
  }

  if (completionKind) {
    return completionKind === "released";
  }

  if (session.phase === "error") {
    return !isRateLimitedSession(session);
  }

  if (session.phase !== "completed") {
    return false;
  }

  const message = session.message.toLowerCase();
  return (
    message.includes("already applied") ||
    message.includes("no application form detected") ||
    message.includes("no apply button found")
  );
}

export function buildQueuedJobSessionMessage(
  site: SiteKey,
  getReadableSiteName: (site: SiteKey) => string
): string {
  return `Queued this ${getReadableSiteName(site)} job page. It will start automatically when an application slot is available.`;
}
