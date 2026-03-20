// src/content/types.ts
// COMPLETE FILE — replace entirely

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

// FIX: Add type for form field descriptor
export interface FieldDescriptor {
  question: string;
  type: string;
  name: string;
  id: string;
  placeholder: string;
  autocomplete: string;
  ariaLabel: string;
  required: boolean;
}

// FIX: Add type for job page context
export interface JobPageContext {
  title: string;
  company: string;
  location: string;
  description: string;
  url: string;
  site: string;
}

// FIX: Add type for autofill match
export interface AutofillMatch {
  field: AutofillField;
  value: string;
  source: "profile" | "saved" | "inferred";
  confidence: number;
}
