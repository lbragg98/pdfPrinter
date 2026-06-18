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
