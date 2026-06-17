import { expect, test } from "@playwright/test";

test("topic submit opens interrupt and yes returns the pdf link", async ({ page }) => {
  const pdfUrl = "https://example.com/for-loops-study-sheet.pdf";
  const dirtyPdfUrl = `${pdfUrl})`;
  const finalMessage =
    `Your clean, beginner-friendly Python study sheet PDF is ready to download: ${pdfUrl}`;
  const interrupt = {
    skillId: "skill-export-pdf",
    skillName: "Export PDF",
    skillThreadId: "study-sheet-thread_skill_skill-export-pdf_interrupt",
    node: "interrupt_confirm_pdf",
    nodeLabel: "Confirm PDF",
    feedbackRequest:
      "Would you like me to turn this study sheet into a downloadable PDF?",
    state: {
      study_sheet: "Study sheet draft for For Loops"
    }
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
      expect(body.input).toContain("For Loops");

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          interrupt,
          study_sheet: "Study sheet draft for For Loops",
          waitingForInput: true,
          message:
            "Skill export to pdf is waiting for human input at node Interrupt. It looks like your workflow has generated a Python Study Sheet: For Loops (Beginner) with 5 practice questions and an answer key. Would you like me to turn this into a downloadable PDF?"
        })
      });
      return;
    }

    expect(body.input).toBe("");
    expect(body.resume_skill_interrupt).toEqual({
      interrupt,
      resumeData: "yes"
    });

    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: [
        { chunk: "Your" },
        { chunk: " clean, beginner-friendly Python study sheet PDF is ready to download: " },
        { chunk: pdfUrl },
        { download_url: dirtyPdfUrl },
        "[DONE]"
      ]
        .map((event) =>
          typeof event === "string" ? `data: ${event}\n\n` : `data: ${JSON.stringify(event)}\n\n`
        )
        .join("")
    });
  });

  await page.goto("/");

  await page.getByRole("textbox", { name: "Topic" }).fill("For Loops");
  await page.getByRole("button", { name: "Send topic" }).click();

  await expect(page.getByRole("dialog", { name: /confirm pdf creation/i })).toBeVisible();
  await page.getByRole("button", { name: "Yes" }).click();

  await expect(page.getByRole("link", { name: /download your pdf/i })).toHaveAttribute(
    "href",
    pdfUrl
  );
  await expect(page.getByText(finalMessage)).toBeVisible();
});
