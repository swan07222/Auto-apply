import {
  buildQueuedJobSessionMessage,
  isManagedJobSession,
  isManagedJobSessionActive,
  isManagedJobSessionPending,
  isManagedJobStage,
  isSuccessfulJobCompletion,
  resolveContentReadySession,
  shouldQueueManagedJobSession,
  shouldReleaseManagedJobOpening,
} from "../src/background/sessionState";
import type { AutomationSession, SpawnTabRequest } from "../src/shared";

function createSession(
  overrides: Partial<AutomationSession> = {}
): AutomationSession {
  return {
    tabId: 1,
    site: "indeed",
    phase: "running",
    message: "Running",
    shouldResume: true,
    stage: "open-apply",
    runId: "run-1",
    updatedAt: 1,
    ...overrides,
  };
}

function createSpawn(
  overrides: Partial<SpawnTabRequest> = {}
): SpawnTabRequest {
  return {
    url: "https://www.indeed.com/viewjob?jk=abc123",
    site: "indeed",
    stage: "open-apply",
    ...overrides,
  };
}

describe("background session state helpers", () => {
  it("claims a frame-bound session only when the frame looks like an application surface", async () => {
    const persisted: AutomationSession[] = [];
    const session = createSession({
      stage: "autofill-form",
      controllerFrameId: undefined,
    });

    const unresolved = await resolveContentReadySession(
      session,
      7,
      false,
      async (next) => {
        persisted.push(next);
      }
    );
    expect(unresolved.shouldResume).toBe(false);
    expect(persisted).toHaveLength(0);

    const resolved = await resolveContentReadySession(
      session,
      7,
      true,
      async (next) => {
        persisted.push(next);
      }
    );
    expect(resolved.shouldResume).toBe(true);
    expect(resolved.session.controllerFrameId).toBe(7);
    expect(persisted).toHaveLength(1);
  });

  it("recognizes managed job stages and queueing rules", () => {
    expect(isManagedJobStage("open-apply")).toBe(true);
    expect(isManagedJobStage("autofill-form")).toBe(true);
    expect(isManagedJobStage("collect-results")).toBe(false);

    expect(
      shouldQueueManagedJobSession(
        createSpawn({ runId: "run-1" }),
        createSession({ runId: "run-1", stage: "open-apply" })
      )
    ).toBe(false);

    expect(
      shouldQueueManagedJobSession(
        createSpawn({ runId: "run-1" }),
        createSession({ runId: "run-2", stage: "collect-results" })
      )
    ).toBe(false);

    expect(
      shouldQueueManagedJobSession(
        createSpawn({ runId: "run-1" }),
        createSession({ runId: "run-2", stage: "bootstrap" })
      )
    ).toBe(true);
  });

  it("classifies managed session lifecycle states", () => {
    const active = createSession();
    const pending = createSession({
      shouldResume: false,
      phase: "idle",
    });

    expect(isManagedJobSession(active)).toBe(true);
    expect(isManagedJobSessionActive(active)).toBe(true);
    expect(isManagedJobSessionPending(pending)).toBe(true);
  });

  it("distinguishes successful completions from releasable failures", () => {
    const successful = createSession({
      phase: "completed",
      message: "Filled 3 fields. Review before submitting.",
    });
    const released = createSession({
      phase: "completed",
      message: "No apply button found.",
    });
    const rateLimited = createSession({
      phase: "error",
      message: "Rate limited by the site.",
    });

    expect(isSuccessfulJobCompletion(successful)).toBe(true);
    expect(shouldReleaseManagedJobOpening(released)).toBe(true);
    expect(shouldReleaseManagedJobOpening(rateLimited)).toBe(false);
  });

  it("builds queued session copy through a site-name formatter", () => {
    expect(
      buildQueuedJobSessionMessage("monster", (site) =>
        site === "monster" ? "Monster" : site
      )
    ).toContain("Queued this Monster job page");
  });
});
