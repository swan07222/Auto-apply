type PdfJsLike = {
  GlobalWorkerOptions: {
    workerPort: Worker | null;
  };
};

let sharedPdfWorkerPort: Worker | null = null;

export function ensurePdfJsWorkerPort(pdfjs: PdfJsLike): void {
  if (typeof Worker === "undefined" || pdfjs.GlobalWorkerOptions.workerPort) {
    return;
  }

  pdfjs.GlobalWorkerOptions.workerPort = getSharedPdfWorkerPort();
}

function getSharedPdfWorkerPort(): Worker {
  sharedPdfWorkerPort ||= new Worker(
    getBundledExtensionAssetUrl("pdf.worker.mjs"),
    {
      type: "module",
      name: "pdfjs-content-worker",
    }
  );

  return sharedPdfWorkerPort;
}

export function getBundledExtensionAssetUrl(filename: string): string {
  const manifest = chrome.runtime.getManifest();
  const contentScriptPath = manifest.content_scripts?.[0]?.js?.[0] ?? "";

  if (!contentScriptPath.includes("/")) {
    return chrome.runtime.getURL(filename);
  }

  const basePath = contentScriptPath.replace(/[^/]+$/, "");
  return chrome.runtime.getURL(`${basePath}${filename}`);
}

export function resetPdfJsWorkerPortForTests(): void {
  sharedPdfWorkerPort = null;
}
