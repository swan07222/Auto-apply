export type MockStorageState = Record<string, unknown>;

export function createMockChromeStorageLocal(initial: MockStorageState = {}) {
  const state: MockStorageState = { ...initial };

  return {
    state,
    async get(key?: string | string[] | Record<string, unknown>) {
      if (typeof key === "string") {
        return { [key]: state[key] };
      }

      if (Array.isArray(key)) {
        return Object.fromEntries(key.map((entry) => [entry, state[entry]]));
      }

      if (key && typeof key === "object") {
        return Object.fromEntries(
          Object.keys(key).map((entry) => [entry, state[entry] ?? key[entry]])
        );
      }

      return { ...state };
    },
    async set(update: Record<string, unknown>) {
      Object.assign(state, update);
    },
    async remove(key: string | string[]) {
      for (const entry of Array.isArray(key) ? key : [key]) {
        delete state[entry];
      }
    },
    async clear() {
      for (const key of Object.keys(state)) {
        delete state[key];
      }
    },
  };
}
