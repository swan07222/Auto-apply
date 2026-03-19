import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
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
        "src/content/text.ts",
        "src/content/dom.ts",
        "src/content/jobSearch.ts",
        "src/content/apply.ts",
        "src/content/autofill.ts",
        "src/content/answerMemory.ts",
        "src/content/pdfWorker.ts",
        "src/content/resumeUpload.ts",
      ],
      thresholds: {
        lines: 60,
        functions: 75,
        statements: 60,
        branches: 50,
      },
    },
  },
});
