import { expect, test } from "@playwright/test";

test("topic submit opens interrupt and yes returns the pdf link", async ({
  page,
}) => {
  const pdfUrl = "https://example.com/for-loops-study-sheet.pdf";
  const dirtyPdfUrl = `${pdfUrl})`;
  const interrupt = {
    skillId: "skill-export-pdf",
    skillName: "Export PDF",
    skillThreadId: "study-sheet-thread_skill_skill-export-pdf_interrupt",
    node: "interrupt_confirm_pdf",
    interrupt_node_id: "interrupt_confirm_pdf",
    nodeLabel: "Confirm PDF",
    feedbackRequest:
      "Would you like me to turn this study sheet into a downloadable PDF?",
    state: {
      study_sheet: "Study sheet draft for For Loops",
    },
  };
  let requestCount = 0;

  await page.route("**/api/orchestrator/run", async (route) => {
    requestCount += 1;
    const request = route.request();
    const body = JSON.parse(request.postData() ?? "{}") as {
      input?: string;
      resume_skill_interrupt?: unknown;
    };

    if (requestCount === 1) {
      expect(body.input).toBe("python Study sheet about For Loops");

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          interrupt,
          study_sheet: "Study sheet draft for For Loops",
          waitingForInput: true,
          message:
            "It looks like your workflow has generated a Python Study Sheet: For Loops (Beginner) with 5 practice questions and an answer key. Would you like me to turn this into a downloadable PDF?",
        }),
      });
      return;
    }

    expect(body.input).toBe("");
    expect(body.resume_skill_interrupt).toMatchObject({
      interrupt,
      resumeData: "yes",
    });

    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: [
        { chunk: "Your" },
        {
          chunk:
            " clean, beginner-friendly Python study sheet PDF is ready to download: ",
        },
        { chunk: pdfUrl },
        { download_url: dirtyPdfUrl },
        "[DONE]",
      ]
        .map((event) =>
          typeof event === "string"
            ? `data: ${event}\n\n`
            : `data: ${JSON.stringify(event)}\n\n`,
        )
        .join(""),
    });
  });

  await page.goto("/");

  await page.getByRole("tab", { name: "Study Sheet" }).click();
  await page.getByRole("textbox", { name: "Topic" }).fill("For Loops");
  await page.getByRole("button", { name: "Send topic" }).click();

  await expect(
    page.getByRole("dialog", { name: /confirm pdf creation/i }),
  ).toBeVisible();
  await expect(page.getByText("Pick the second answer")).toHaveCount(0);
  await page.getByRole("button", { name: "Yes" }).click();

  await expect(
    page.getByRole("link", { name: /download your pdf/i }),
  ).toHaveAttribute("href", pdfUrl);
});

test("topic submit opens interrupt and no keeps the flow going", async ({
  page,
}) => {
  const pdfUrl = "https://example.com/for-loops-study-sheet.pdf";
  const interrupt = {
    skillId: "skill-export-pdf",
    skillName: "Export PDF",
    skillThreadId: "study-sheet-thread_skill_skill-export-pdf_interrupt",
    node: "interrupt_confirm_pdf",
    interrupt_node_id: "interrupt_confirm_pdf",
    nodeLabel: "Confirm PDF",
    feedbackRequest:
      "Would you like me to turn this study sheet into a downloadable PDF?",
    state: {
      study_sheet: "Study sheet draft for For Loops",
    },
  };
  let requestCount = 0;

  await page.route("**/api/orchestrator/run", async (route) => {
    requestCount += 1;
    const request = route.request();
    const body = JSON.parse(request.postData() ?? "{}") as {
      input?: string;
      resume_skill_interrupt?: {
        resumeData?: string;
      };
    };

    if (requestCount === 1) {
      expect(body.input).toBe("python Study sheet about For Loops");

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          interrupt,
          study_sheet: "Study sheet draft for For Loops",
          waitingForInput: true,
          message:
            "It looks like your workflow has generated a Python Study Sheet: For Loops (Beginner) with 5 practice questions and an answer key. Would you like me to turn this into a downloadable PDF?",
        }),
      });
      return;
    }

    expect(body.input).toBe("");
    expect(body.resume_skill_interrupt).toMatchObject({
      resumeData: "no",
    });

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        type: "done",
        deploymentId: "dep-1",
        environment: "prod",
        message: "Study sheet ready without PDF",
        study_sheet: "Study sheet draft for For Loops",
        download_url: pdfUrl,
      }),
    });
  });

  await page.goto("/");

  await page.getByRole("tab", { name: "Study Sheet" }).click();
  await page.getByRole("textbox", { name: "Topic" }).fill("For Loops");
  await page.getByRole("button", { name: "Send topic" }).click();

  await expect(
    page.getByRole("dialog", { name: /confirm pdf creation/i }),
  ).toBeVisible();
  await page.getByRole("button", { name: "No" }).click();

  await expect(
    page.getByRole("dialog", { name: /confirm pdf creation/i }),
  ).toHaveCount(0);
  await expect(page.getByText("Study sheet draft for For Loops")).toBeVisible();
  await expect(
    page.getByRole("link", { name: /download your pdf/i }),
  ).toHaveAttribute("href", pdfUrl);
});

test("quiz structuredResponse renders one question at a time", async ({
  page,
}) => {
  await page.route("**/api/orchestrator/run", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        message: "quiz ready",
        study_sheet: "Study sheet draft",
        structuredResponse: {
          AnswerKey: ["B"],
          Questions: [
            {
              QuestionTitle: "Pick the second answer",
              Answers: ["Alpha", "Beta", "Gamma", "Delta"],
              CorrectAnswer: "B",
            },
          ],
        },
      }),
    });
  });

  await page.goto("/");

  await page.getByRole("textbox", { name: "Topic" }).fill("Quiz Topic");
  await page.getByRole("button", { name: "Send topic" }).click();

  await expect(page.getByText("Pick the second answer")).toBeVisible();

  const wrongAnswer = page.getByRole("button", { name: /Alpha/ });
  await wrongAnswer.click();

  await expect(page.getByText("Incorrect")).toBeVisible();
  await expect(page.getByText("Correct answer: B. Beta")).toBeVisible();
  await expect(wrongAnswer).toBeDisabled();

  await page.getByRole("button", { name: "Next", exact: true }).click();

  await expect(page.getByText("You got 0 out of 1 correct.")).toBeVisible();

  await page.getByRole("button", { name: "Restart Quiz" }).click();

  await expect(page.getByText("Pick the second answer")).toBeVisible();
});

test("import flow uploads a file through the mcp import endpoint", async ({
  page,
}) => {
  let orchestratorCalls = 0;
  let postCalls = 0;
  let eventCalls = 0;

  await page.route("**/api/orchestrator/run", async (route) => {
    orchestratorCalls += 1;
    const request = route.request();
    const body = JSON.parse(request.postData() ?? "{}") as {
      input?: string;
      scopeId?: string;
    };

    expect(body.scopeId).toBe("SampleApp/Category1/*");
    expect(body.input).toContain("Selected retrieval scope: SampleApp/Category1/*");
    expect(body.input).toContain("Selected scope label: Category1");
    expect(body.input).toContain("Files expected in scope: notes.txt");
    expect(body.input).toContain(
      "User question: Summarize this file in one sentence.",
    );

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        message: "This file is a short local note that says hello from local file upload.",
      }),
    });
  });

  await page.route("**/api/imports**", async (route) => {
    const request = route.request();
    const url = request.url();
    const body = request.postData() ?? "";

    if (request.method() === "POST" && url.endsWith("/api/imports")) {
      postCalls += 1;
      expect(request.headers()["content-type"]).toContain(
        "multipart/form-data",
      );
      expect(body).toContain("notes.txt");
      expect(body).toContain("SampleApp/Category1/notes.txt");

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            id: "upload-123",
            message: "Import queued for notes.txt",
          },
          upstreamStatus: 202,
        }),
      });
      return;
    }

    if (
      request.method() === "GET" &&
      url.includes("/api/imports/upload-123/events")
    ) {
      eventCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          events: [
            { stage: "parsing", status: "complete" },
            { stage: "embedding", status: "pending" },
          ],
        }),
      });
      return;
    }

    throw new Error(`Unexpected import request: ${request.method()} ${url}`);
  });

  await page.goto("/");

  await page.getByRole("tab", { name: "Import" }).click();
  await page.getByLabel("Upload category").fill("Category1");
  await page.getByLabel("Upload files").setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("hello from local file upload"),
  });
  await page.getByRole("button", { name: "Upload selected files" }).click();

  await expect(page.getByText('"stage": "embedding"')).toBeVisible();
  await page
    .getByLabel("Question about selected scope")
    .fill("Summarize this file in one sentence.");
  await page.getByRole("button", { name: "Ask using selected scope" }).click();

  await expect(
    page.getByText(
      "This file is a short local note that says hello from local file upload.",
    ),
  ).toBeVisible();
  await expect(page.getByText("Scope:")).toBeVisible();
  await expect(page.getByRole("button", { name: "notes.txt" })).toBeVisible();
  expect(postCalls).toBe(1);
  expect(eventCalls).toBe(1);
  expect(orchestratorCalls).toBe(1);
});

test("import tab loads stored file references and supports file-level scope", async ({
  page,
}) => {
  let orchestratorCalls = 0;

  await page.addInitScript(() => {
    window.localStorage.setItem(
      "pdf-printer-import-catalog",
      JSON.stringify([
        {
          localId: "import-ref-1",
          fileName: "notes.txt",
          categoryPath: "Category1",
          scopeId: "SampleApp/Category1/notes.txt",
          importId: "upload-123",
          uploadedAt: "2026-06-24T12:00:00.000Z",
          processingStatus: "complete",
          fileType: "text/plain",
          fileSize: 29,
        },
        {
          localId: "import-ref-2",
          fileName: "outline.pdf",
          categoryPath: "Category2",
          scopeId: "SampleApp/Category2/outline.pdf",
          importId: "upload-456",
          uploadedAt: "2026-06-24T12:05:00.000Z",
          processingStatus: "complete",
          fileType: "application/pdf",
          fileSize: 2048,
        },
      ]),
    );
  });

  await page.route("**/api/orchestrator/run", async (route) => {
    orchestratorCalls += 1;
    const request = route.request();
    const body = JSON.parse(request.postData() ?? "{}") as {
      input?: string;
      scopeId?: string;
    };

    expect(body.scopeId).toBe("SampleApp/Category2/outline.pdf");
    expect(body.input).toContain(
      "Selected retrieval scope: SampleApp/Category2/outline.pdf",
    );
    expect(body.input).toContain(
      "Selected scope label: Category2 / outline.pdf",
    );
    expect(body.input).toContain("Files expected in scope: outline.pdf");
    expect(body.input).toContain("User question: What is this file mainly about?");

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        message: "The outline file is mainly about a project plan.",
      }),
    });
  });

  await page.goto("/");
  await page.getByRole("tab", { name: "Import" }).click();

  await expect(
    page.getByText("Ask a one-off question using the selected scope."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "notes.txt" })).toBeVisible();
  await expect(page.getByRole("button", { name: "outline.pdf" })).toBeVisible();

  await page.getByRole("button", { name: "outline.pdf" }).click();
  await page
    .getByLabel("Question about selected scope")
    .fill("What is this file mainly about?");
  await page.getByRole("button", { name: "Ask using selected scope" }).click();

  await expect(
    page.getByText("The outline file is mainly about a project plan."),
  ).toBeVisible();
  expect(orchestratorCalls).toBe(1);
});
