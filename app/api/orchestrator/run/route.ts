import {
  ORCHESTRATOR_BASE_URL,
  ORCHESTRATOR_PROJECT_ID,
  ORCHESTRATOR_RUN_API_KEY,
  ORCHESTRATOR_RUN_PATH
} from "../../../../lib/orchestrator-config";

type OrchestratorRunBody = {
  threadId?: string;
  input?: string;
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

  const upstreamResponse = await fetch(new URL(ORCHESTRATOR_RUN_PATH, ORCHESTRATOR_BASE_URL), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ORCHESTRATOR_RUN_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      projectId: ORCHESTRATOR_PROJECT_ID,
      threadId: body.threadId,
      input: body.input
    }),
    cache: "no-store"
  });

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: {
      "Content-Type": upstreamResponse.headers.get("content-type") ?? "text/plain; charset=utf-8"
    }
  });
}
