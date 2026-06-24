const MCP_IMPORT_BASE_URL = process.env.MCP_IMPORT_BASE_URL ?? "";
const MCP_IMPORT_API_TOKEN = process.env.MCP_IMPORT_API_TOKEN ?? "";
const MCP_SCOPE_ID = "logan-test";
const MCP_USER_ID = "12345";

export async function POST(request: Request) {
  if (!MCP_IMPORT_BASE_URL) {
    return Response.json(
      { error: "MCP_IMPORT_BASE_URL is not configured." },
      { status: 500 },
    );
  }

  if (!MCP_IMPORT_API_TOKEN) {
    return Response.json(
      { error: "MCP_IMPORT_API_TOKEN is not configured." },
      { status: 500 },
    );
  }

  const formData = await request.formData();
  const file = formData.get("file");
  const url = formData.get("url");

  console.log("[imports route] request received", {
    hasFile: file instanceof File,
    fileName: file instanceof File ? file.name : "",
    fileSize: file instanceof File ? file.size : null,
    fileType: file instanceof File ? file.type : "",
    hasUrl: typeof url === "string" && Boolean(url.trim()),
  });

  if (!(file instanceof File) && typeof url !== "string") {
    return Response.json(
      { error: "Upload a file or provide a URL." },
      { status: 400 },
    );
  }

  const upstreamBody = new FormData();
  if (file instanceof File) {
    upstreamBody.append("file", file, file.name);
  } else if (typeof url === "string" && url.trim()) {
    upstreamBody.append("url", url.trim());
  }

  const upstreamResponse = await fetch(
    new URL("/api/imports", MCP_IMPORT_BASE_URL),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${MCP_IMPORT_API_TOKEN}`,
        "Scope-ID": MCP_SCOPE_ID,
        "User-ID": MCP_USER_ID,
      },
      body: upstreamBody,
      cache: "no-store",
    },
  );

  console.log("[imports route] upstream response", {
    status: upstreamResponse.status,
    ok: upstreamResponse.ok,
  });

  const responseText = await upstreamResponse.text();
  const responseMessage =
    extractResponseMessage(responseText) || responseText.trim();
  const responseJson = extractJson(responseText);

  if (!upstreamResponse.ok) {
    return Response.json(
      {
        error:
          normalizeErrorMessage(responseMessage) ||
          `Import request failed with status ${upstreamResponse.status}.`,
      },
      { status: upstreamResponse.status },
    );
  }

  return Response.json({
    ...(responseJson ?? {}),
    message:
      responseMessage ||
      (file instanceof File
        ? `Import queued for ${file.name}.`
        : `Import queued for ${String(url).trim()}.`),
    upstreamStatus: upstreamResponse.status,
  });
}

function extractResponseMessage(text: string) {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return typeof parsed.message === "string" ? parsed.message : "";
  } catch {
    return "";
  }
}

function extractJson(text: string) {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizeErrorMessage(message: string) {
  const trimmed = message.trim();
  if (!trimmed) {
    return "";
  }

  return trimmed.startsWith("<")
    ? "The import service returned an unexpected HTML error page."
    : trimmed;
}
