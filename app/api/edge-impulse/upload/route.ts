import { NextResponse } from "next/server";

export const runtime = "nodejs";

interface UploadRequestBody {
  category?: "training" | "testing";
  csv?: string;
  fileName?: string;
  label?: string;
}

export async function POST(req: Request) {
  const apiKey =
    process.env.EDGE_IMPULSE_API_KEY ?? process.env.EI_PROJECT_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Missing Edge Impulse API key. Set EDGE_IMPULSE_API_KEY in your environment.",
      },
      { status: 500 }
    );
  }

  let body: UploadRequestBody;
  try {
    body = (await req.json()) as UploadRequestBody;
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body." },
      { status: 400 }
    );
  }

  const category = body.category === "testing" ? "testing" : "training";
  const csv = body.csv?.trim();
  const fileName = body.fileName?.trim();
  const label = sanitizeLabel(body.label);

  if (!csv) {
    return NextResponse.json(
      { success: false, error: "Missing CSV payload." },
      { status: 400 }
    );
  }

  if (!fileName) {
    return NextResponse.json(
      { success: false, error: "Missing file name." },
      { status: 400 }
    );
  }

  if (!label) {
    return NextResponse.json(
      { success: false, error: "Missing label." },
      { status: 400 }
    );
  }

  const baseUrl =
    process.env.EDGE_IMPULSE_INGESTION_BASE_URL ??
    "https://ingestion.edgeimpulse.com";

  const formData = new FormData();
  formData.append("data", new Blob([csv], { type: "text/csv" }), fileName);

  const response = await fetch(`${baseUrl}/api/${category}/files`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "x-label": label,
    },
    body: formData,
  });

  const text = await response.text();
  if (!response.ok) {
    return NextResponse.json(
      {
        success: false,
        error: text || "Edge Impulse upload failed.",
      },
      { status: response.status }
    );
  }

  return NextResponse.json({
    success: true,
    category,
    storedAs: text.trim(),
  });
}

function sanitizeLabel(label: string | undefined): string {
  return (label ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
