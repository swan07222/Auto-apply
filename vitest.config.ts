import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
    clearMocks: true,
    restoreMocks: true,
    mockReset: true,
    unstubGlobals: true,
    unstubEnvs: true,
    passWithNoTests: false,
    allowOnly: false,
    environmentOptions: {
      jsdom: {
        url: "https://example.com/",
      },
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary", "lcov"],
      include: [
        "src/shared.ts",
        "src/popup.ts",
        "src/popupDialog.ts",
        "src/content/sitePatterns.ts",
        "src/content/text.ts",
        "src/content/dom.ts",
        "src/content/applicationSurface.ts",
        "src/content/jobSearch.ts",
        "src/content/apply.ts",
        "src/content/autofill.ts",
        "src/content/answerMemory.ts",
        "src/content/pdfWorker.ts",
        "src/content/progression.ts",
        "src/content/resumeUpload.ts",
      ],
      thresholds: {
        lines: 75,
        functions: 90,
        statements: 75,
        branches: 65,
      },
    },
  },
});
