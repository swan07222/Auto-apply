import { JobContextSnapshot, ResumeAsset } from "../shared";
import { ensurePdfJsWorkerPort } from "./pdfWorker";
import { cleanText, truncateText } from "./text";

const MAX_RESUME_TEXT_CHARS = 24_000;

export function extractCurrentJobContextSnapshot(
  question: string
): JobContextSnapshot {
  const title = pickFirstText([
    cleanText(
      document.querySelector<HTMLElement>(
        "h1, [data-testid='jobsearch-JobInfoHeader-title'], [data-testid*='job-title'], [class*='job-title'], [class*='jobTitle']"
      )?.textContent
    ),
    cleanText(
      document
        .querySelector<HTMLMetaElement>("meta[property='og:title']")
        ?.getAttribute("content")
    ),
    cleanText(document.title),
  ]);
  const company = pickFirstText([
    cleanText(
      document.querySelector<HTMLElement>(
        "[data-testid='inlineHeader-companyName'], [data-testid*='company'], [class*='company'], .company, [class*='employer']"
      )?.textContent
    ),
    cleanText(
      document
        .querySelector<HTMLMetaElement>("meta[name='author']")
        ?.getAttribute("content")
    ),
  ]);
  const description = collectBestJobDescriptionText();

  return {
    title,
    company,
    question,
    description: truncateText(description, 12_000),
    pageUrl: window.location.href,
  };
}

export function collectBestJobDescriptionText(): string {
  const selectorCandidates = [
    "#jobDescriptionText",
    "[data-testid='jobDescriptionText']",
    "[data-testid*='jobDescription']",
    "[data-testid*='JobDescription']",
    ".jobsearch-JobComponent-description",
    "[class*='jobsearch-JobComponent-description']",
    "[class*='job-description']",
    "[class*='jobDescription']",
    "[id*='jobDescription']",
    "[class*='description']",
    "[role='main']",
    "main",
    "article",
  ];
  let best = "";
  let bestScore = -1;

  for (const selector of selectorCandidates) {
    let elements: HTMLElement[];
    try {
      elements = Array.from(document.querySelectorAll<HTMLElement>(selector));
    } catch {
      continue;
    }

    for (const element of elements) {
      const text = cleanText(element.innerText || element.textContent || "");
      if (!text || text.length < 120) {
        continue;
      }

      const lower = text.toLowerCase();
      let score = text.length;
      if (lower.includes("responsibilities")) score += 200;
      if (lower.includes("requirements")) score += 200;
      if (lower.includes("qualifications")) score += 180;
      if (lower.includes("about the role")) score += 180;
      if (lower.includes("about this role")) score += 180;
      if (lower.includes("job description")) score += 180;
      if (lower.includes("application")) score -= 120;
      if (lower.includes("sign in")) score -= 120;

      if (score > bestScore) {
        best = text;
        bestScore = score;
      }
    }
  }

  return best;
}

export function mergeJobContextSnapshots(
  remembered: JobContextSnapshot | null,
  current: JobContextSnapshot,
  question: string
): JobContextSnapshot {
  return {
    title: pickBestText([current.title, remembered?.title ?? ""]),
    company: pickBestText([current.company, remembered?.company ?? ""]),
    description: pickBestText([
      current.description,
      remembered?.description ?? "",
    ]),
    question,
    pageUrl: current.pageUrl || remembered?.pageUrl || window.location.href,
  };
}

export function isUsefulJobContextSnapshot(
  context: JobContextSnapshot
): boolean {
  return Boolean(
    context.title || context.company || context.description.length >= 120
  );
}

export async function prepareResumeAssetForAi(
  asset: ResumeAsset | null
): Promise<ResumeAsset | null> {
  if (!asset) {
    return null;
  }

  if (asset.textContent.trim()) {
    return asset;
  }

  const extractedText = await extractResumeTextFromStoredAsset(asset);
  if (!extractedText) {
    return asset;
  }

  return {
    ...asset,
    textContent: extractedText,
  };
}

export function buildChatGptRequestUrl(requestId: string): string {
  const url = new URL("https://chatgpt.com/");
  url.searchParams.set("remoteJobSearchRequest", requestId);
  return url.toString();
}

function pickFirstText(values: string[]): string {
  return values.map((value) => cleanText(value)).find(Boolean) ?? "";
}

function pickBestText(values: string[]): string {
  return values
    .map((value) => cleanText(value))
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)[0] ?? "";
}

async function extractResumeTextFromStoredAsset(
  asset: ResumeAsset
): Promise<string> {
  try {
    const extension = getResumeAssetExtension(asset);

    if (extension === "pdf" || asset.type === "application/pdf") {
      return clampResumeText(await extractPdfResumeTextFromAsset(asset));
    }

    if (extension === "docx") {
      return clampResumeText(await extractDocxResumeTextFromAsset(asset));
    }

    if (
      extension === "txt" ||
      extension === "md" ||
      extension === "rtf" ||
      asset.type.startsWith("text/")
    ) {
      const response = await fetch(asset.dataUrl);
      return clampResumeText(await response.text());
    }

    if (extension === "doc") {
      const response = await fetch(asset.dataUrl);
      return clampResumeText(
        extractPrintableTextFromBuffer(await response.arrayBuffer())
      );
    }
  } catch {
    // Ignore resume extraction failures.
  }

  return "";
}

async function extractPdfResumeTextFromAsset(
  asset: ResumeAsset
): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  ensurePdfJsWorkerPort(pdfjs);

  const response = await fetch(asset.dataUrl);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const loadingTask = pdfjs.getDocument({
    data: bytes,
    useWorkerFetch: false,
    isEvalSupported: false,
    stopAtErrors: false,
  });

  const pdf = await loadingTask.promise;
  const pages: string[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item) =>
          typeof item === "object" && item !== null && "str" in item
            ? String(item.str || "")
            : ""
        )
        .join(" ");
      pages.push(pageText);
    }
  } finally {
    await pdf.destroy();
  }

  return pages.join("\n");
}

async function extractDocxResumeTextFromAsset(
  asset: ResumeAsset
): Promise<string> {
  const mammothModule = await import("mammoth");
  const mammoth = (mammothModule.default ?? mammothModule) as {
    extractRawText(input: {
      arrayBuffer: ArrayBuffer;
    }): Promise<{ value: string }>;
  };
  const response = await fetch(asset.dataUrl);
  const result = await mammoth.extractRawText({
    arrayBuffer: await response.arrayBuffer(),
  });
  return result.value || "";
}

function extractPrintableTextFromBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let text = "";

  for (const byte of bytes) {
    if (
      byte === 9 ||
      byte === 10 ||
      byte === 13 ||
      (byte >= 32 && byte <= 126)
    ) {
      text += String.fromCharCode(byte);
    } else {
      text += " ";
    }
  }

  return text;
}

function clampResumeText(text: string): string {
  return text
    .replace(/\u0000/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_RESUME_TEXT_CHARS);
}

function getResumeAssetExtension(asset: ResumeAsset): string {
  const match = asset.name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? "";
}
