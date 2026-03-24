// Shared content-script types for apply, autofill, and search flows.

import { ResumeAsset } from "../shared";

export type ApplyAction =
  | { type: "navigate"; url: string; description: string }
  | { type: "click"; element: HTMLElement; description: string };

export type ProgressionAction = ApplyAction & { text: string };

export type JobCandidate = {
  url: string;
  title: string;
  contextText: string;
};

export type AutofillField =
  | HTMLInputElement
  | HTMLTextAreaElement
  | HTMLSelectElement;

export interface AutofillResult {
  filledFields: number;
  usedSavedAnswers: number;
  usedProfileAnswers: number;
  uploadedResume: ResumeAsset | null;
}
