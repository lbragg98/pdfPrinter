const MCP_IMPORT_BASE_URL = process.env.MCP_IMPORT_BASE_URL ?? "";
const MCP_IMPORT_API_TOKEN = process.env.MCP_IMPORT_API_TOKEN ?? "";
const MCP_SCOPE_ID = "logan-test";
const MCP_USER_ID = "12345";

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
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

  const { id } = params;

  if (!id) {
    return Response.json({ error: "Import id is required." }, { status: 400 });
  }

  const upstreamResponse = await fetch(
    new URL(`/api/imports/${id}`, MCP_IMPORT_BASE_URL),
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${MCP_IMPORT_API_TOKEN}`,
        "Scope-ID": MCP_SCOPE_ID,
        "User-ID": MCP_USER_ID,
      },
      cache: "no-store",
    },
  );

  const responseText = await upstreamResponse.text();

  if (!upstreamResponse.ok) {
    return Response.json(
      {
        error: extractResponseMessage(responseText) || responseText.trim(),
      },
      { status: upstreamResponse.status },
    );
  }

  return Response.json(extractJson(responseText) ?? {});
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
