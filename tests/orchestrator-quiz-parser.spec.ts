import { expect, test } from "@playwright/test";
import { extractTextFromSse, normalizeAgentResponse } from "../lib/orchestrator";

test("done event structuredResponse becomes quizResponse", () => {
  const raw = [
    `data: ${JSON.stringify({ type: "message", message: "working..." })}\n\n`,
    `data: ${JSON.stringify({
      type: "done",
      deploymentId: "dep-1",
      environment: "prod",
      message: "complete",
      structuredResponse: {
        AnswerKey: ["A"],
        Questions: [
          {
            QuestionTitle: "Pick A",
            Answers: ["A", "B", "C", "D"],
            CorrectAnswer: "A",
          },
        ],
      },
    })}\n\n`,
  ].join("");

  const response = normalizeAgentResponse(raw, extractTextFromSse(raw));

  expect(response.message).toBe("complete");
  expect(response.quizResponse).toEqual({
    AnswerKey: ["A"],
    Questions: [
      {
        QuestionTitle: "Pick A",
        Answers: ["A", "B", "C", "D"],
        CorrectAnswer: "A",
      },
    ],
  });
});

test("orchestrator route forwards the scope id header upstream", async () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.ORCHESTRATOR_RUN_API_KEY;
  const originalProjectId = process.env.ORCHESTRATOR_PROJECT_ID;
  const originalBaseUrl = process.env.ORCHESTRATOR_BASE_URL;
  const originalRunPath = process.env.ORCHESTRATOR_RUN_PATH;

  process.env.ORCHESTRATOR_RUN_API_KEY = "test-key";
  process.env.ORCHESTRATOR_PROJECT_ID = "test-project";
  process.env.ORCHESTRATOR_BASE_URL = "https://example.invalid";
  process.env.ORCHESTRATOR_RUN_PATH = "/api/run";

  let captured:
    | {
        input: RequestInfo | URL;
        init?: RequestInit;
      }
    | undefined;

  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    captured = { input, init };
    return new Response(
      JSON.stringify({
        type: "done",
        deploymentId: "dep-1",
        environment: "prod",
        message: "complete",
        structuredResponse: null,
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  }) as typeof fetch;

  try {
    const { POST } = await import("../app/api/orchestrator/run/route");
    const request = new Request("http://localhost/api/orchestrator/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        threadId: "thread-1",
        input: "hello",
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(String(captured?.input)).toBe("https://example.invalid/api/run");

    const headers = Object.fromEntries(
      new Headers(captured?.init?.headers as HeadersInit),
    );
    expect(headers).toMatchObject({
      authorization: "Bearer test-key",
      "content-type": "application/json",
      "scope-id": "logan-test",
    });
  } finally {
    global.fetch = originalFetch;
    process.env.ORCHESTRATOR_RUN_API_KEY = originalApiKey;
    process.env.ORCHESTRATOR_PROJECT_ID = originalProjectId;
    process.env.ORCHESTRATOR_BASE_URL = originalBaseUrl;
    process.env.ORCHESTRATOR_RUN_PATH = originalRunPath;
  }
});
