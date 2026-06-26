import {
  extractTextFromSse,
  normalizeAgentResponse,
  type ResumeSkillInterrupt
} from "../../../../lib/orchestrator";

const ORCHESTRATOR_SCOPE_ID = "logan-test";

type OrchestratorRunBody = {
  threadId?: string;
  input?: string;
  traceId?: string;
  scopeId?: string;
  resume_skill_interrupt?: ResumeSkillInterrupt;
};

export async function POST(request: Request) {
  const {
    ORCHESTRATOR_BASE_URL,
    ORCHESTRATOR_PROJECT_ID,
    ORCHESTRATOR_RUN_API_KEY,
    ORCHESTRATOR_RUN_PATH,
  } = getOrchestratorConfig();

  if (!ORCHESTRATOR_RUN_API_KEY) {
    return Response.json({ error: "ORCHESTRATOR_RUN_API_KEY is not configured." }, { status: 500 });
  }

  if (!ORCHESTRATOR_PROJECT_ID) {
    return Response.json({ error: "ORCHESTRATOR_PROJECT_ID is not configured." }, { status: 500 });
  }

  if (!ORCHESTRATOR_RUN_PATH) {
    return Response.json({ error: "ORCHESTRATOR_RUN_PATH is not configured." }, { status: 500 });
  }

  const body = (await request.json()) as OrchestratorRunBody;

  const input = typeof body.input === "string" ? body.input : "";
  const isResumeRequest = Boolean(body.resume_skill_interrupt?.interrupt);

  if (!body.threadId || (!input && !isResumeRequest)) {
    return Response.json({ error: "threadId and input are required." }, { status: 400 });
  }

  const stopOnInterrupt = !isConfirmationReply(input);

  console.log("[orchestrator route] request", {
    traceId: body.traceId || body.threadId,
    threadId: body.threadId,
    scopeId: typeof body.scopeId === "string" ? body.scopeId : ORCHESTRATOR_SCOPE_ID,
    stopOnInterrupt,
    isResumeRequest,
    inputPreview: input.slice(0, 240)
  });

  const normalized = await runSingleUpstreamRun(body, stopOnInterrupt);

  console.log("[orchestrator route] response", {
    traceId: body.traceId || body.threadId,
    threadId: body.threadId,
    waitingForInput: normalized.waitingForInput,
    interruptNodeId: normalized.interruptNodeId || "(missing)",
    downloadUrl: normalized.downloadUrl || "(missing)",
    messagePreview: normalized.message.slice(0, 200),
    studySheetPreview: normalized.studySheet.slice(0, 200)
  });

  return Response.json(normalized);
}

async function runSingleUpstreamRun(body: OrchestratorRunBody, stopOnInterrupt: boolean) {
  const {
    ORCHESTRATOR_BASE_URL,
    ORCHESTRATOR_PROJECT_ID,
    ORCHESTRATOR_RUN_API_KEY,
    ORCHESTRATOR_RUN_PATH,
  } = getOrchestratorConfig();

  const scopeId =
    typeof body.scopeId === "string" && body.scopeId.trim()
      ? body.scopeId.trim()
      : ORCHESTRATOR_SCOPE_ID;

  const upstreamResponse = await fetch(new URL(ORCHESTRATOR_RUN_PATH, ORCHESTRATOR_BASE_URL), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ORCHESTRATOR_RUN_API_KEY}`,
      "Content-Type": "application/json",
      "Scope-ID": scopeId
    },
    body: JSON.stringify({
      projectId: ORCHESTRATOR_PROJECT_ID,
      threadId: body.threadId,
      input: typeof body.input === "string" ? body.input : "",
      traceId: body.traceId,
      ...(body.resume_skill_interrupt
        ? { resume_skill_interrupt: body.resume_skill_interrupt }
        : {})
    }),
    cache: "no-store"
  });

  const contentType = upstreamResponse.headers.get("content-type") ?? "";
  const raw = upstreamResponse.body ? await readUpstreamBody(upstreamResponse, stopOnInterrupt) : "";
  const extractedText =
    contentType.includes("text/event-stream") || raw.includes("\ndata:")
      ? extractTextFromSse(raw)
      : raw.trim();

  return normalizeAgentResponse(raw, extractedText);
}

async function readUpstreamBody(response: Response, stopOnInterrupt: boolean) {
  const reader = response.body?.getReader();

  if (!reader) {
    return "";
  }

  const decoder = new TextDecoder();
  let raw = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      raw += decoder.decode(value, { stream: true });

      if (stopOnInterrupt && hasCompleteInterrupt(raw)) {
        break;
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // Ignore cancel errors during early exit.
    }
  }

  raw += decoder.decode();
  return raw;
}

function hasCompleteInterrupt(raw: string) {
  for (const eventBlock of raw.split(/\n\s*\n/)) {
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
        if (parsed.type === "skill_interrupt" && parsed.interrupt) {
          return true;
        }
      } catch {
        // Wait for a complete JSON event before stopping the stream early.
      }
    }
  }

  return false;
}

function isConfirmationReply(input: string) {
  const normalized = input.trim().toLowerCase();
  return normalized === "yes" || normalized === "no";
}

function getOrchestratorConfig() {
  return {
    ORCHESTRATOR_RUN_API_KEY: process.env.ORCHESTRATOR_RUN_API_KEY ?? "",
    ORCHESTRATOR_PROJECT_ID: process.env.ORCHESTRATOR_PROJECT_ID ?? "",
    ORCHESTRATOR_BASE_URL:
      process.env.ORCHESTRATOR_BASE_URL ?? "https://agent-authoring-flatiron-school.vercel.app",
    ORCHESTRATOR_RUN_PATH: process.env.ORCHESTRATOR_RUN_PATH ?? "",
  };
}
