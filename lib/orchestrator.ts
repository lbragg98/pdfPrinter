import { ORCHESTRATOR_PROJECT_ID } from "./orchestrator-config";

type RunPromptArgs = {
  threadId: string;
  input: string;
};

export function createThreadId(prefix: string) {
  const suffix =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  return `${prefix}-${suffix}`;
}

export function buildStudySheetPrompt(topic: string) {
  return [
    "Study Sheet Builder",
    "Create a concise beginner-friendly study sheet for the topic below.",
    "Stop after the study sheet draft and wait for the confirmation interrupt.",
    "Do not create a PDF yet.",
    "",
    `Topic: ${topic.trim()}`
  ].join("\n");
}

export function buildDownloadPrompt(topic: string, studySheet: string) {
  return [
    "Study Sheet Builder",
    "The user confirmed they want a printable PDF.",
    "Create the final downloadable PDF link or a short message with the link.",
    "Return only the download link or a very short response containing it.",
    "",
    `Topic: ${topic.trim()}`,
    `Study sheet draft: ${studySheet.trim()}`
  ].join("\n");
}

export async function runOrchestratorPrompt({ threadId, input }: RunPromptArgs) {
  const response = await fetch("/api/orchestrator/run", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      threadId,
      input
    })
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(text || `Orchestrator request failed with status ${response.status}.`);
  }

  const contentType = response.headers.get("content-type");
  if (contentType?.includes("text/event-stream") || text.includes("\ndata:")) {
    return extractTextFromSse(text);
  }

  return extractBestText(text, contentType);
}

function extractBestText(text: string, contentType: string | null) {
  if (!contentType?.includes("application/json")) {
    return text.trim();
  }

  try {
    const parsed = JSON.parse(text) as
      | string
      | {
          output?: unknown;
          message?: unknown;
          response?: unknown;
          data?: { output?: unknown; message?: unknown; response?: unknown };
        };

    if (typeof parsed === "string") {
      return parsed.trim();
    }

    const candidate =
      parsed.output ??
      parsed.message ??
      parsed.response ??
      parsed.data?.output ??
      parsed.data?.message ??
      parsed.data?.response;

    return typeof candidate === "string" ? candidate.trim() : text.trim();
  } catch {
    return text.trim();
  }
}

function extractTextFromSse(payload: string) {
  const pieces: string[] = [];

  for (const eventBlock of payload.split(/\n\s*\n/)) {
    const dataLines = eventBlock
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart());

    for (const data of dataLines) {
      if (!data || data === "[DONE]") {
        continue;
      }

      try {
        const parsed = JSON.parse(data) as Record<string, unknown>;
        const nestedData = parsed.data as Record<string, unknown> | undefined;

        const chunk =
          (typeof parsed.chunk === "string" && parsed.chunk) ||
          (typeof parsed.message === "string" && parsed.message) ||
          (typeof parsed.text === "string" && parsed.text) ||
          (typeof nestedData?.chunk === "string" && nestedData.chunk) ||
          (typeof nestedData?.message === "string" && nestedData.message) ||
          (typeof nestedData?.text === "string" && nestedData.text) ||
          "";

        if (chunk) {
          pieces.push(chunk);
        }
      } catch {
        if (!data.startsWith("{") && !data.startsWith("[")) {
          pieces.push(data);
        }
      }
    }
  }

  const combined = pieces.join("").trim();
  return combined || payload.trim();
}

export function getProjectId() {
  return ORCHESTRATOR_PROJECT_ID;
}
