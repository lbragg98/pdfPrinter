import { ORCHESTRATOR_PROJECT_ID } from "./orchestrator-config";

export type OrchestratorResponse = {
  raw: string;
  text: string;
  studySheet: string;
  downloadUrl: string;
  message: string;
  interruptRequested: boolean;
  interruptNodeId: string;
  interrupt: SkillInterruptPayload | null;
  waitingForInput: boolean;
};

export type SkillInterruptPayload = {
  [key: string]: unknown;
  skillId: string;
  skillName: string;
  skillThreadId: string;
  node: string;
  nodeLabel?: string;
  feedbackRequest?: string;
  state?: Record<string, unknown>;
};

export type ResumeSkillInterrupt = {
  interrupt: SkillInterruptPayload;
  resumeData: unknown;
};

type RunPromptArgs = {
  threadId: string;
  input: string;
  traceId?: string;
  resumeSkillInterrupt?: ResumeSkillInterrupt;
};

export function createThreadId(prefix: string) {
  const suffix =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  return `${prefix}-${suffix}`;
}

export function buildStudySheetPrompt(topic: string) {
  return JSON.stringify({
    request: `Create a study sheet for Python '${topic.trim()}' including practice questions and explanations.`
  });
}

export function buildDownloadPrompt(
  topic: string,
  studySheet: string,
  confirmationResponse = "Yes"
) {
  return [
    "Study Sheet Builder",
    "The user confirmed they want a printable PDF.",
    `User confirmation: ${confirmationResponse.trim()}`,
    "Return only valid JSON with these keys:",
    '{ "download_url": string, "message": string }',
    "download_url must be the full downloadable PDF URL.",
    "message should briefly confirm the PDF is ready.",
    "",
    `Topic: ${topic.trim()}`,
    `Study sheet draft: ${studySheet.trim()}`
  ].join("\n");
}

export async function runOrchestratorPrompt({
  threadId,
  input,
  traceId,
  resumeSkillInterrupt
}: RunPromptArgs): Promise<OrchestratorResponse> {
  console.log("[orchestrator client] request", {
    traceId: traceId || threadId,
    threadId,
    inputPreview: input.slice(0, 220)
  });

  const response = await fetch("/api/orchestrator/run", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      threadId,
      input,
      traceId,
      ...(resumeSkillInterrupt
        ? { resume_skill_interrupt: resumeSkillInterrupt }
        : {})
    })
  });

  const raw = await response.text();

  if (!response.ok) {
    throw new Error(raw || `Orchestrator request failed with status ${response.status}.`);
  }

  const contentType = response.headers.get("content-type");
  const extractedText =
    contentType?.includes("text/event-stream") || raw.includes("\ndata:")
      ? extractTextFromSse(raw)
      : extractBestText(raw, contentType);

  const normalized = normalizeAgentResponse(raw, extractedText);

  console.log("[orchestrator client] response", {
    traceId: traceId || threadId,
    threadId,
    waitingForInput: normalized.waitingForInput,
    interruptNodeId: normalized.interruptNodeId || "(missing)",
    downloadUrl: normalized.downloadUrl || "(missing)",
    messagePreview: normalized.message.slice(0, 220),
    studySheetPreview: normalized.studySheet.slice(0, 220)
  });

  return normalized;
}

export function getProjectId() {
  return ORCHESTRATOR_PROJECT_ID;
}

function extractBestText(text: string, contentType: string | null) {
  if (!contentType?.includes("application/json")) {
    return text.trim();
  }

  const parsed = parseJson(text);
  if (!parsed) {
    return text.trim();
  }

  const fields = collectAgentFields(parsed);
  return fields.text || text.trim();
}

export function normalizeAgentResponse(raw: string, extractedText: string): OrchestratorResponse {
  const parsed = parseJson(raw);
  const isSse = raw.includes("data:");
  const fields = isSse ? collectFieldsFromSse(raw) : emptyFields();
  collectAgentFields(parsed, fields);
  const trimmedExtractedText = extractedText.trim();
  const assembledSseText =
    isSse && trimmedExtractedText !== raw.trim() ? trimmedExtractedText : "";
  const text = assembledSseText || fields.text || trimmedExtractedText || fields.studySheet;
  const downloadUrl =
    cleanUrlCandidate(fields.downloadUrl) ||
    extractFirstUrl(fields.studySheet) ||
    extractFirstUrl(text) ||
    extractFirstUrl(raw);
  const waitingForInput =
    (fields.waitingForInput || detectWaitingForInput(parsed, raw, text)) && !downloadUrl;
  const interruptRequested = waitingForInput;
  const interruptNodeId = fields.interruptNodeId || extractInterruptNodeId(parsed, raw);

  return {
    raw,
    text,
    studySheet: fields.studySheet || text,
    downloadUrl,
    message: assembledSseText || fields.message || fields.studySheet || text,
    interruptRequested,
    interruptNodeId,
    interrupt: fields.interrupt,
    waitingForInput
  };
}

function parseJson(text: string) {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

type CollectedFields = {
  text: string;
  studySheet: string;
  downloadUrl: string;
  message: string;
  interruptNodeId: string;
  interrupt: SkillInterruptPayload | null;
  waitingForInput: boolean;
};

type StringFieldKey = "text" | "studySheet" | "downloadUrl" | "message" | "interruptNodeId";

function collectAgentFields(value: unknown, fields: CollectedFields = emptyFields()): CollectedFields {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed && !fields.text) {
      fields.text = trimmed;
    }
    return fields;
  }

  if (!value || typeof value !== "object") {
    return fields;
  }

  const record = value as Record<string, unknown>;
  const interruptRecord =
    record.interrupt && typeof record.interrupt === "object"
      ? (record.interrupt as Record<string, unknown>)
      : null;

  if (record.type === "skill_interrupt") {
    fields.waitingForInput = true;
  }

  if (record.waitingForInput === true || record.interruptRequested === true) {
    fields.waitingForInput = true;
  }

  if (!fields.interrupt && isSkillInterruptPayload(interruptRecord)) {
    fields.interrupt = interruptRecord;
  }

  if (!fields.interrupt && isSkillInterruptPayload(record)) {
    fields.interrupt = record;
  }

  const explicitInterruptNodeId = extractFirstString([
    interruptRecord?.node,
    interruptRecord?.nodeId,
    interruptRecord?.interrupt_node_id,
    interruptRecord?.interruptNodeId,
    interruptRecord?.interrupt_node,
    interruptRecord?.interruptNode
  ]);

  if (explicitInterruptNodeId) {
    fields.interruptNodeId = explicitInterruptNodeId;
  }

  setFirstString(fields, "studySheet", record.study_sheet);
  setFirstString(fields, "studySheet", record.study_questions);
  setFirstString(fields, "studySheet", record.created_questions);
  setFirstString(fields, "downloadUrl", record.download_url);
  setFirstString(fields, "downloadUrl", record.pdf_url);
  setFirstString(fields, "message", record.message);
  setFirstString(fields, "message", record.feedbackRequest);
  setFirstString(fields, "message", record.feedback_request);
  setFirstString(fields, "text", record.text);
  setFirstString(fields, "text", record.output);
  setFirstString(fields, "text", record.response);
  setFirstString(fields, "text", record.content);
  setFirstString(fields, "text", record.chunk);
  setFirstString(fields, "text", record.study_sheet);
  setFirstString(fields, "text", record.study_questions);
  setFirstString(fields, "text", record.created_questions);
  setFirstString(fields, "text", record.download_url);
  setFirstString(fields, "text", record.pdf_url);
  setFirstString(fields, "text", record.message);
  if (!fields.interruptNodeId) {
    setFirstString(fields, "interruptNodeId", record.interrupt_node_id);
    setFirstString(fields, "interruptNodeId", record.interruptNodeId);
    setFirstString(fields, "interruptNodeId", record.interrupt_node);
    setFirstString(fields, "interruptNodeId", record.interruptNode);
    setFirstString(fields, "interruptNodeId", record.node);
    setFirstString(fields, "interruptNodeId", record.nodeId);
  }

  if (record.__final_payload__ !== undefined) {
    collectAgentFields(record.__final_payload__, fields);
  }

  if (record.result !== undefined) {
    collectAgentFields(record.result, fields);
  }

  if (record.data !== undefined) {
    collectAgentFields(record.data, fields);
  }

  if (record.interrupt !== undefined) {
    collectAgentFields(record.interrupt, fields);
  }

  if (record.state !== undefined) {
    collectAgentFields(record.state, fields);
  }

  if (!fields.text) {
    const fallback = extractFirstString([
      record.study_sheet,
      record.study_questions,
      record.created_questions,
      record.download_url,
      record.pdf_url,
      record.message,
      record.feedbackRequest,
      record.feedback_request,
      record.output,
      record.response,
      record.text,
      record.chunk,
      record.content
    ]);

    if (fallback) {
      fields.text = fallback;
    }
  }

  return fields;
}

function emptyFields(): CollectedFields {
  return {
    text: "",
    studySheet: "",
    downloadUrl: "",
    message: "",
    interruptNodeId: "",
    interrupt: null,
    waitingForInput: false
  };
}

function isSkillInterruptPayload(value: unknown): value is SkillInterruptPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    typeof record.skillId === "string" &&
    typeof record.skillName === "string" &&
    typeof record.skillThreadId === "string" &&
    typeof record.node === "string"
  );
}

function setFirstString(fields: CollectedFields, key: StringFieldKey, value: unknown) {
  if (fields[key]) {
    return;
  }

  if (typeof value === "string" && value.trim()) {
    fields[key] = key === "downloadUrl" ? cleanUrlCandidate(value) : value.trim();
  }
}

function extractFirstString(values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

function extractFirstUrl(text: string) {
  return cleanUrlCandidate(text.match(/https?:\/\/\S+/i)?.[0] ?? "");
}

function cleanUrlCandidate(value: string) {
  return value.trim().replace(/[)\].,;:!?'""]+$/g, "");
}

function extractInterruptNodeId(parsed: unknown, raw: string): string {
  const candidates: unknown[] = [parsed, raw];

  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      const match = candidate.match(/\binterrupt_[a-z0-9-]+\b/i);
      if (match?.[0]) {
        return match[0];
      }
      continue;
    }

    if (!candidate || typeof candidate !== "object") {
      continue;
    }

    const record = candidate as Record<string, unknown>;
    const interruptRecord =
      record.interrupt && typeof record.interrupt === "object"
        ? (record.interrupt as Record<string, unknown>)
        : null;
    const candidateId = extractFirstString([
      interruptRecord?.node,
      interruptRecord?.nodeId,
      interruptRecord?.interrupt_node_id,
      interruptRecord?.interruptNodeId,
      interruptRecord?.interrupt_node,
      interruptRecord?.interruptNode,
      record.interrupt_node_id,
      record.interruptNodeId,
      record.interrupt_node,
      record.interruptNode,
      record.node,
      record.nodeId
    ]);

    if (candidateId) {
      return candidateId;
    }

    if (record.__final_payload__ !== undefined) {
      const nested = extractInterruptNodeId(record.__final_payload__, raw);
      if (nested) {
        return nested;
      }
    }

    if (record.result !== undefined) {
      const nested = extractInterruptNodeId(record.result, raw);
      if (nested) {
        return nested;
      }
    }

    if (record.data !== undefined) {
      const nested = extractInterruptNodeId(record.data, raw);
      if (nested) {
        return nested;
      }
    }
  }

  return "";
}

function detectWaitingForInput(parsed: unknown, raw: string, text: string) {
  const normalized = [parsed, raw, text]
    .map((candidate) => {
      if (typeof candidate === "string") {
        return candidate;
      }

      if (!candidate || typeof candidate !== "object") {
        return "";
      }

      const record = candidate as Record<string, unknown>;
      return [
        record.type,
        record.message,
        record.text,
        record.output,
        record.response,
        record.content,
        record.feedbackRequest,
        record.feedback_request
      ]
        .filter((value): value is string => typeof value === "string")
        .join("\n");
    })
    .join("\n")
    .toLowerCase();

  return (
    normalized.includes('"type":"skill_interrupt"') ||
    normalized.includes("skill_interrupt") ||
    normalized.includes("feedbackrequest") ||
    normalized.includes("waiting for human input")
  );
}

function collectFieldsFromSse(payload: string) {
  const fields = emptyFields();

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
        const parsed = JSON.parse(data) as unknown;
        collectAgentFields(parsed, fields);
      } catch {
        if (!data.startsWith("{") && !data.startsWith("[")) {
          setFirstString(fields, "text", data);
        }
      }
    }
  }

  return fields;
}

export function extractTextFromSse(payload: string) {
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
