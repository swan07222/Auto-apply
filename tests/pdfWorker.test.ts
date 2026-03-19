import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ensurePdfJsWorkerPort,
  getBundledExtensionAssetUrl,
  resetPdfJsWorkerPortForTests,
} from "../src/content/pdfWorker";

type MockWorkerRecord = {
  url: string;
  options?: WorkerOptions;
};

const workerCreations: MockWorkerRecord[] = [];

class MockWorker {
  constructor(url: string | URL, options?: WorkerOptions) {
    workerCreations.push({
      url: String(url),
      options,
    });
  }
}

describe("pdf worker helper", () => {
  beforeEach(() => {
    workerCreations.length = 0;
    resetPdfJsWorkerPortForTests();

    vi.stubGlobal("chrome", {
      runtime: {
        getManifest: () => ({
          content_scripts: [{ js: ["dist/content.js"] }],
        }),
        getURL: (path: string) => `chrome-extension://test/${path}`,
      },
    });

    vi.stubGlobal("Worker", MockWorker);
  });

  it("builds the worker URL relative to the bundled content script path", () => {
    expect(getBundledExtensionAssetUrl("pdf.worker.mjs")).toBe(
      "chrome-extension://test/dist/pdf.worker.mjs"
    );
  });

  it("creates a shared module worker port for pdf.js", () => {
    const pdfjs = {
      GlobalWorkerOptions: {
        workerPort: null,
      },
    };

    ensurePdfJsWorkerPort(pdfjs);
    const firstPort = pdfjs.GlobalWorkerOptions.workerPort;
    ensurePdfJsWorkerPort({
      GlobalWorkerOptions: {
        workerPort: null,
      },
    });

    expect(workerCreations).toHaveLength(1);
    expect(firstPort).toBeInstanceOf(MockWorker);
    expect(workerCreations[0]).toEqual({
      url: "chrome-extension://test/dist/pdf.worker.mjs",
      options: {
        type: "module",
        name: "pdfjs-content-worker",
      },
    });
  });

  it("does not replace an existing pdf.js worker port", () => {
    const existingPort = new MockWorker("chrome-extension://test/existing.js");
    const pdfjs = {
      GlobalWorkerOptions: {
        workerPort: existingPort as unknown as Worker,
      },
    };

    ensurePdfJsWorkerPort(pdfjs);

    expect(workerCreations).toHaveLength(1);
    expect(pdfjs.GlobalWorkerOptions.workerPort).toBe(existingPort);
  });
});
