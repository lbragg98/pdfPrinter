import { expect, test } from "@playwright/test";

test("import route forwards file uploads with MCP headers", async () => {
  const originalFetch = global.fetch;
  const originalBaseUrl = process.env.MCP_IMPORT_BASE_URL;
  const originalToken = process.env.MCP_IMPORT_API_TOKEN;

  process.env.MCP_IMPORT_BASE_URL = "https://example.invalid";
  process.env.MCP_IMPORT_API_TOKEN = "test-token";

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
        id: "upload-123",
        message: "queued",
        processing_status: "pending",
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  }) as typeof fetch;

  try {
    const { POST } = await import("../app/api/imports/route");
    const formData = new FormData();
    formData.append(
      "file",
      new File(["hello"], "notes.pdf", { type: "application/pdf" }),
    );

    const request = new Request("http://localhost/api/imports", {
      method: "POST",
      body: formData,
    });

    const response = await POST(request);
    const payload = (await response.json()) as {
      message?: string;
      upstreamStatus?: number;
    };

    expect(response.status).toBe(200);
    expect(payload.message).toBe("queued");
    expect(payload.id).toBe("upload-123");
    expect(payload.upstreamStatus).toBe(200);
    expect(String(captured?.input)).toBe("https://example.invalid/api/imports");

    const headers = Object.fromEntries(
      new Headers(captured?.init?.headers as HeadersInit),
    );
    expect(headers).toMatchObject({
      authorization: "Bearer test-token",
      "scope-id": "logan-test",
      "user-id": "12345",
    });

    const body = captured?.init?.body as FormData | undefined;
    const forwardedFile = body?.get("file");

    expect(forwardedFile).toBeInstanceOf(File);
    expect((forwardedFile as File | null)?.name).toBe("notes.pdf");
  } finally {
    global.fetch = originalFetch;
    process.env.MCP_IMPORT_BASE_URL = originalBaseUrl;
    process.env.MCP_IMPORT_API_TOKEN = originalToken;
  }
});

test("status route forwards import id with MCP headers", async () => {
  const originalFetch = global.fetch;
  const originalBaseUrl = process.env.MCP_IMPORT_BASE_URL;
  const originalToken = process.env.MCP_IMPORT_API_TOKEN;

  process.env.MCP_IMPORT_BASE_URL = "https://example.invalid";
  process.env.MCP_IMPORT_API_TOKEN = "test-token";

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
        id: "upload-123",
        processing_status: "complete",
        file_name: "notes.pdf",
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  }) as typeof fetch;

  try {
    const { GET } = await import("../app/api/imports/[id]/route");

    const response = await GET(
      new Request("http://localhost/api/imports/upload-123"),
      { params: { id: "upload-123" } },
    );
    const payload = (await response.json()) as {
      id?: string;
      processing_status?: string;
    };

    expect(response.status).toBe(200);
    expect(payload.id).toBe("upload-123");
    expect(payload.processing_status).toBe("complete");
    expect(String(captured?.input)).toBe(
      "https://example.invalid/api/imports/upload-123",
    );

    const headers = Object.fromEntries(
      new Headers(captured?.init?.headers as HeadersInit),
    );
    expect(headers).toMatchObject({
      authorization: "Bearer test-token",
      "scope-id": "logan-test",
      "user-id": "12345",
    });
  } finally {
    global.fetch = originalFetch;
    process.env.MCP_IMPORT_BASE_URL = originalBaseUrl;
    process.env.MCP_IMPORT_API_TOKEN = originalToken;
  }
});
