import { expect, test } from "@playwright/test";

test("topic submit opens interrupt and yes returns the pdf link", async ({ page }) => {
  const pdfUrl = "https://example.com/for-loops-study-sheet.pdf";
  let requestCount = 0;

  await page.route("**/api/orchestrator/run", async (route) => {
    requestCount += 1;
    const request = route.request();
    const body = JSON.parse(request.postData() ?? "{}") as {
      input?: string;
    };

    if (requestCount === 1) {
      expect(body.input).toContain("For Loops");

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          interrupt: true,
          study_sheet: "Study sheet draft for For Loops",
          waitingForInput: true,
          message:
            "Skill export to pdf is waiting for human input at node Interrupt. It looks like your workflow has generated a Python Study Sheet: For Loops (Beginner) with 5 practice questions and an answer key. Would you like me to turn this into a downloadable PDF?"
        })
      });
      return;
    }

    expect(body.input).toBe("yes");

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        result: {
          study_sheet:
            `Your clean, beginner-friendly Python study sheet PDF is ready to download: ${pdfUrl}`
        },
        download_url: pdfUrl,
        message: "Your PDF is ready."
      })
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
});
