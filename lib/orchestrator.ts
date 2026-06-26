import { ORCHESTRATOR_PROJECT_ID } from "./orchestrator-config";

export type OrchestratorResponse = {
  raw: string;
  text: string;
  studySheet: string;
  structuredResponse: unknown;
  quizResponse: QuizResponse | null;
  downloadUrl: string;
  message: string;
  interruptRequested: boolean;
  interruptNodeId: string;
  interrupt: SkillInterruptPayload | null;
  waitingForInput: boolean;
};

export type AnswerLetter = "A" | "B" | "C" | "D";

export type QuizResponse = {
  AnswerKey: AnswerLetter[];
  Questions: QuizQuestion[];
};

export type QuizQuestion = {
  Answers: string[];
  CorrectAnswer: AnswerLetter;
  QuestionTitle: string;
};

export type StreamMessageEvent = {
  type: "message";
  message?: string;
  chunk?: string;
  text?: string;
};

export type StreamDoneEvent = {
  type: "done";
  deploymentId: string;
  environment: string;
  message: string;
  structuredResponse: unknown;
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
  scopeId?: string;
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
    request: `'${topic.trim()}'`,
    quizResponseSchema: {
      AnswerKey: ["C", "D", "A", "B", "C", "A", "D", "B", "C", "A"],
      Questions: [
        {
          Answers: [
            "They can see in complete darkness",
            "They have a specialized reflective layer behind their retina",
            "Their eyes are larger than those of other animals",
            "Their pupils can change shape",
          ],
          CorrectAnswer: "B",
          QuestionTitle:
            "What gives cats the ability to see well in low light conditions?",
        },
      ],
    },
    quizInstructions:
      "If quizzes are generated, return them as valid JSON that follows quizResponseSchema exactly. Keep the study sheet and quizzes separate.",
  });
}

export function buildDownloadPrompt(
  topic: string,
  studySheet: string,
  confirmationResponse = "Yes",
) {
  return [
    "Keep the study sheet and quizzes separate.",
    `User confirmation: ${confirmationResponse.trim()}`,
    "Return only valid JSON with these keys:",
    `Topic: ${topic.trim()}`,
    `Study sheet draft: ${studySheet.trim()}`,
  ].join("\n");
}

export async function runOrchestratorPrompt({
  threadId,
  input,
  traceId,
  scopeId,
  resumeSkillInterrupt,
}: RunPromptArgs): Promise<OrchestratorResponse> {
  console.log("[orchestrator client] request", {
    traceId: traceId || threadId,
    threadId,
    inputPreview: input.slice(0, 220),
  });

  const response = await fetch("/api/orchestrator/run", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      threadId,
      input,
      traceId,
      ...(scopeId ? { scopeId } : {}),
      ...(resumeSkillInterrupt
        ? { resume_skill_interrupt: resumeSkillInterrupt }
        : {}),
    }),
  });

  const raw = await response.text();

  if (!response.ok) {
    throw new Error(
      raw || `Orchestrator request failed with status ${response.status}.`,
    );
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
    studySheetPreview: normalized.studySheet.slice(0, 220),
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

export function normalizeAgentResponse(
  raw: string,
  extractedText: string,
): OrchestratorResponse {
  const parsed = parseJson(raw);
  const isSse = raw.includes("data:");
  const fields = isSse ? collectFieldsFromSse(raw) : emptyFields();
  collectAgentFields(parsed, fields);
  const trimmedExtractedText = extractedText.trim();
  const assembledSseText =
    isSse && trimmedExtractedText !== raw.trim() ? trimmedExtractedText : "";
  const text =
    assembledSseText ||
    fields.text ||
    trimmedExtractedText ||
    fields.studySheet;
  const quizResponse =
    extractQuizResponseFromDoneEvent(parsed) ||
    fields.quizResponse ||
    extractQuizResponse(parsed) ||
    extractQuizResponse(text) ||
    extractQuizResponse(raw);
  const downloadUrl =
    cleanUrlCandidate(fields.downloadUrl) ||
    extractFirstUrl(fields.studySheet) ||
    extractFirstUrl(text) ||
    extractFirstUrl(raw);
  const waitingForInput =
    (fields.waitingForInput || detectWaitingForInput(parsed, raw, text)) &&
    !downloadUrl;
  const interruptRequested = waitingForInput;
  const interruptNodeId =
    fields.interruptNodeId || extractInterruptNodeId(parsed, raw);

  return {
    raw,
    text,
    studySheet: fields.studySheet || text,
    structuredResponse:
      fields.structuredResponse ?? extractStructuredResponse(parsed),
    quizResponse,
    downloadUrl,
    message: assembledSseText || fields.message || fields.studySheet || text,
    interruptRequested,
    interruptNodeId,
    interrupt: fields.interrupt,
    waitingForInput,
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
  structuredResponse: unknown;
  quizResponse: QuizResponse | null;
  downloadUrl: string;
  message: string;
  interruptNodeId: string;
  interrupt: SkillInterruptPayload | null;
  waitingForInput: boolean;
};

type StringFieldKey =
  | "text"
  | "studySheet"
  | "downloadUrl"
  | "message"
  | "interruptNodeId";

function collectAgentFields(
  value: unknown,
  fields: CollectedFields = emptyFields(),
): CollectedFields {
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
  const doneEvent = isStreamDoneEvent(record) ? record : null;
  if (doneEvent) {
    fields.message = doneEvent.message;
    fields.text = doneEvent.message;
    if (fields.structuredResponse === null) {
      fields.structuredResponse = doneEvent.structuredResponse;
    }
    if (!fields.quizResponse) {
      fields.quizResponse = extractQuizResponse(doneEvent.structuredResponse);
    }
  }

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

  if (!fields.quizResponse) {
    fields.quizResponse = extractQuizResponse(record);
  }

  const explicitInterruptNodeId = extractFirstString([
    interruptRecord?.node,
    interruptRecord?.nodeId,
    interruptRecord?.interrupt_node_id,
    interruptRecord?.interruptNodeId,
    interruptRecord?.interrupt_node,
    interruptRecord?.interruptNode,
  ]);

  if (explicitInterruptNodeId) {
    fields.interruptNodeId = explicitInterruptNodeId;
  }

  setFirstString(fields, "studySheet", record.study_sheet);
  setFirstString(fields, "studySheet", record.study_questions);
  setFirstString(fields, "studySheet", record.created_questions);
  if (fields.structuredResponse === null && "structuredResponse" in record) {
    fields.structuredResponse = record.structuredResponse;
  }
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
      record.content,
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
    structuredResponse: null,
    quizResponse: null,
    downloadUrl: "",
    message: "",
    interruptNodeId: "",
    interrupt: null,
    waitingForInput: false,
  };
}

function isSkillInterruptPayload(
  value: unknown,
): value is SkillInterruptPayload {
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

function isQuizResponse(value: unknown): value is QuizResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    Array.isArray(record.AnswerKey) &&
    record.AnswerKey.every((entry) => isAnswerLetter(entry)) &&
    Array.isArray(record.Questions) &&
    record.Questions.every((question) => {
      if (
        !question ||
        typeof question !== "object" ||
        Array.isArray(question)
      ) {
        return false;
      }

      const questionRecord = question as Record<string, unknown>;
      return (
        Array.isArray(questionRecord.Answers) &&
        questionRecord.Answers.every((entry) => typeof entry === "string") &&
        isAnswerLetter(questionRecord.CorrectAnswer) &&
        typeof questionRecord.QuestionTitle === "string"
      );
    })
  );
}

function isAnswerLetter(value: unknown): value is AnswerLetter {
  return value === "A" || value === "B" || value === "C" || value === "D";
}

function isStreamDoneEvent(value: unknown): value is StreamDoneEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    record.type === "done" &&
    typeof record.deploymentId === "string" &&
    typeof record.environment === "string" &&
    typeof record.message === "string" &&
    "structuredResponse" in record
  );
}

function isStreamMessageEvent(value: unknown): value is StreamMessageEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return record.type === "message";
}

export function extractQuizResponse(value: unknown): QuizResponse | null {
  if (typeof value === "string") {
    return (
      extractQuizResponseFromText(value) ||
      extractQuizResponse(parseJson(value))
    );
  }

  if (isStreamDoneEvent(value)) {
    return isQuizResponse(value.structuredResponse)
      ? value.structuredResponse
      : extractQuizResponse(value.structuredResponse);
  }

  if (isQuizResponse(value)) {
    return value;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  return (
    extractQuizResponse(record.quizzes) ||
    extractQuizResponse(record.quiz_response) ||
    extractQuizResponse(record.quizResponse) ||
    extractQuizResponse(record.quiz)
  );
}

function extractQuizResponseFromDoneEvent(value: unknown): QuizResponse | null {
  if (!isStreamDoneEvent(value)) {
    return null;
  }

  return isQuizResponse(value.structuredResponse)
    ? value.structuredResponse
    : extractQuizResponse(value.structuredResponse);
}

function extractQuizResponseFromText(text: string): QuizResponse | null {
  const fencedBlocks = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map(
    (match) => match[1].trim(),
  );

  for (const block of fencedBlocks) {
    const quiz = extractQuizResponseFromJsonLikeText(block);
    if (quiz) {
      return quiz;
    }
  }

  const direct = extractQuizResponseFromJsonLikeText(text);
  if (direct) {
    return direct;
  }

  return null;
}

function extractQuizResponseFromJsonLikeText(
  text: string,
): QuizResponse | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = parseJson(trimmed);
  if (isQuizResponse(parsed)) {
    return parsed;
  }

  for (const candidate of extractBalancedJsonCandidates(trimmed)) {
    const candidateParsed = parseJson(candidate);
    if (isQuizResponse(candidateParsed)) {
      return candidateParsed;
    }
  }

  return null;
}

function extractBalancedJsonCandidates(text: string) {
  const candidates: string[] = [];
  const stack: number[] = [];
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      stack.push(index);
      continue;
    }

    if (char !== "}" || stack.length === 0) {
      continue;
    }

    const start = stack.pop();
    if (start === undefined) {
      continue;
    }

    const candidate = text.slice(start, index + 1);
    candidates.push(candidate);
  }

  return candidates.sort((left, right) => right.length - left.length);
}

function setFirstString(
  fields: CollectedFields,
  key: StringFieldKey,
  value: unknown,
) {
  if (fields[key]) {
    return;
  }

  if (typeof value === "string" && value.trim()) {
    fields[key] =
      key === "downloadUrl" ? cleanUrlCandidate(value) : value.trim();
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
  const markdownLink = text.match(/\[[^\]]+\]\((https?:\/\/[^\s)]+)\)/i)?.[1];
  if (markdownLink) {
    return cleanUrlCandidate(markdownLink);
  }

  return cleanUrlCandidate(text.match(/https?:\/\/[^\s)]+/i)?.[0] ?? "");
}

function cleanUrlCandidate(value: string) {
  return value.trim().replace(/[)\].,;:!?'""]+$/g, "");
}

function extractStructuredResponse(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  return "structuredResponse" in record ? record.structuredResponse : null;
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
      record.nodeId,
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
        record.feedback_request,
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
        if (isStreamMessageEvent(parsed)) {
          setFirstString(fields, "text", parsed.message);
          setFirstString(fields, "text", parsed.chunk);
          setFirstString(fields, "text", parsed.text);
        }
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
  let finalMessage = "";

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
        if (parsed.type === "done" && typeof parsed.message === "string") {
          finalMessage = parsed.message;
        }

        const chunk =
          (typeof parsed.chunk === "string" && parsed.chunk) ||
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

  if (finalMessage) {
    return finalMessage.trim();
  }

  const combined = pieces.join("").trim();
  return combined || payload.trim();
}
