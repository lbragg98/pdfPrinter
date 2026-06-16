import {
  ORCHESTRATOR_BASE_URL,
  ORCHESTRATOR_PROJECT_ID,
  ORCHESTRATOR_RUN_API_KEY,
  ORCHESTRATOR_RUN_PATH
} from "../../../../lib/orchestrator-config";
import { extractTextFromSse, normalizeAgentResponse } from "../../../../lib/orchestrator";

type OrchestratorRunBody = {
  threadId?: string;
  input?: string;
  traceId?: string;
};

export async function POST(request: Request) {
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

  if (!body.threadId || !body.input) {
    return Response.json({ error: "threadId and input are required." }, { status: 400 });
  }

  const stopOnInterrupt = !isConfirmationReply(body.input);

  console.log("[orchestrator route] request", {
    traceId: body.traceId || body.threadId,
    threadId: body.threadId,
    stopOnInterrupt,
    inputPreview: body.input.slice(0, 240)
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
  const upstreamResponse = await fetch(new URL(ORCHESTRATOR_RUN_PATH, ORCHESTRATOR_BASE_URL), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ORCHESTRATOR_RUN_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      projectId: ORCHESTRATOR_PROJECT_ID,
      threadId: body.threadId,
      input: body.input,
      traceId: body.traceId
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
  const normalized = raw.toLowerCase();

  return normalized.includes("skill_interrupt") && /"node":"interrupt_[^"]+"/i.test(raw);
}

function isConfirmationReply(input: string) {
  const normalized = input.trim().toLowerCase();
  return normalized === "yes" || normalized === "no";
}
