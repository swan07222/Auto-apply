import { AutomationStage } from "../shared";

export type StageRetryState = {
  depth: number;
  scope: string | null;
};

export function createStageRetryState(): StageRetryState {
  return {
    depth: 0,
    scope: null,
  };
}

export function getNextStageRetryState(
  state: StageRetryState,
  stage: AutomationStage,
  url: string
): StageRetryState {
  const normalizedUrl = url.trim();
  const scope = `${stage}:${normalizedUrl}`;

  if (!normalizedUrl || state.scope !== scope) {
    return {
      depth: 1,
      scope,
    };
  }

  return {
    depth: state.depth + 1,
    scope,
  };
}
