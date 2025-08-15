import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

const bodySchema = z.object({
  video: z.string().min(1), // URL or data URL
  output_width: z.number().int().positive().optional(),
  output_height: z.number().int().positive().optional(),
  scale: z.union([z.literal("2"), z.literal("3"), z.literal("4")]).optional(),
});

async function toBufferFromUrlOrDataUrl(input: string): Promise<{ buffer: Buffer; mime: string }> {
  if (input.startsWith("data:")) {
    const match = input.match(/^data:([^;]+);base64,(.*)$/);
    if (!match) throw new Error("Invalid data URL format");
    const mime = match[1];
    const b64 = match[2];
    const buf = Buffer.from(b64, "base64");
    return { buffer: buf, mime };
  }
  const res = await fetch(input);
  if (!res.ok) throw new Error(`Failed to fetch input video: ${res.status}`);
  const ab = await res.arrayBuffer();
  const mime = res.headers.get("content-type") || "video/mp4";
  return { buffer: Buffer.from(ab), mime };
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.TOPAZ_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Missing TOPAZ_API_KEY on server" }, { status: 500 });
    }

    const json = await req.json();
    const parsed = bodySchema.parse(json);
    let { video, output_width, output_height, scale } = parsed;

    // Prepare create payload. Prefer explicit output size if provided; otherwise rely on scale-only.
    const createPayload: Record<string, unknown> = {
      output: {
        ...(typeof output_width === "number" && typeof output_height === "number"
          ? { resolution: { width: output_width, height: output_height } }
          : {}),
        container: "mp4",
      },
      // Keep filters minimal. If API expects explicit upscale model, this can be refined.
      filters: Array.isArray(scale)
        ? []
        : (scale ? [{ model: "upscale", scale: Number(scale) }] : []),
    };

    // Step 1: Create request
    const createResp = await fetch("https://api.topazlabs.com/video/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        accept: "application/json",
        "X-API-Key": apiKey,
      },
      body: JSON.stringify(createPayload),
    });
    const createText = await createResp.text();
    if (!createResp.ok) {
      return NextResponse.json({ error: `Topaz create failed: ${createResp.status}`, details: createText }, { status: 502 });
    }
    let createData: any;
    try { createData = JSON.parse(createText); } catch { createData = {}; }
    const requestId: string | undefined = createData?.id || createData?.requestId || createData?.data?.id;
    if (!requestId) {
      return NextResponse.json({ error: "Topaz create missing request id", raw: createData }, { status: 502 });
    }

    // Step 2: Accept request
    const acceptResp = await fetch(`https://api.topazlabs.com/video/${encodeURIComponent(requestId)}/accept`, {
      method: "PATCH",
      headers: { accept: "application/json", "X-API-Key": apiKey },
    });
    const acceptText = await acceptResp.text();
    if (!acceptResp.ok) {
      return NextResponse.json({ error: `Topaz accept failed: ${acceptResp.status}`, details: acceptText }, { status: 502 });
    }
    let acceptData: any;
    try { acceptData = JSON.parse(acceptText); } catch { acceptData = {}; }
    const uploadUrls: Array<{ partNum?: number; url?: string }> = acceptData?.uploadUrls || acceptData?.data?.uploadUrls || [];
    const singleUrl = uploadUrls[0]?.url || acceptData?.uploadUrl;
    const partNum = uploadUrls[0]?.partNum || 1;
    if (!singleUrl) {
      return NextResponse.json({ error: "Topaz accept missing upload URL", raw: acceptData }, { status: 502 });
    }

    // Step 3: Upload source video (single-part for now)
    const { buffer, mime } = await toBufferFromUrlOrDataUrl(video);
    const putResp = await fetch(singleUrl, {
      method: "PUT",
      headers: { "Content-Type": mime },
      body: buffer,
    });
    if (!putResp.ok) {
      const t = await putResp.text().catch(() => "");
      return NextResponse.json({ error: `Topaz upload failed: ${putResp.status}`, details: t }, { status: 502 });
    }
    const eTag = putResp.headers.get("etag") || putResp.headers.get("ETag") || "";

    // Step 4: Complete upload
    const completeResp = await fetch(`https://api.topazlabs.com/video/${encodeURIComponent(requestId)}/complete-upload`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        accept: "application/json",
        "X-API-Key": apiKey,
      },
      body: JSON.stringify({
        uploadResults: [
          { partNum: partNum, eTag: eTag },
        ],
      }),
    });
    const completeText = await completeResp.text();
    if (!completeResp.ok) {
      return NextResponse.json({ error: `Topaz complete-upload failed: ${completeResp.status}`, details: completeText }, { status: 502 });
    }

    // Step 5: Poll status
    const startedAt = Date.now();
    const timeoutMs = 30 * 60 * 1000; // up to 30 minutes
    let attempt = 0;
    for (;;) {
      if (Date.now() - startedAt > timeoutMs) {
        return NextResponse.json({ error: "Topaz job timed out" }, { status: 504 });
      }
      const statusResp = await fetch(`https://api.topazlabs.com/video/${encodeURIComponent(requestId)}/status`, {
        headers: { accept: "application/json", "X-API-Key": apiKey },
      });
      const statusText = await statusResp.text();
      if (!statusResp.ok) {
        return NextResponse.json({ error: `Topaz status failed: ${statusResp.status}`, details: statusText }, { status: 502 });
      }
      let statusData: any;
      try { statusData = JSON.parse(statusText); } catch { statusData = {}; }
      const state: string | undefined = statusData?.status || statusData?.data?.status;
      if (state && ["completed", "succeeded", "finished", "success"].includes(state.toLowerCase())) {
        // Try to find a URL-looking field
        const candidates: Array<string | undefined> = [
          statusData?.downloadUrl,
          statusData?.outputUrl,
          statusData?.data?.downloadUrl,
          statusData?.data?.outputUrl,
          statusData?.url,
          statusData?.data?.url,
        ];
        const url = candidates.find((u) => typeof u === "string" && /^https?:\/\//i.test(u!));
        return NextResponse.json({ url });
      }
      if (state && ["failed", "error", "canceled", "cancelled"].includes(state.toLowerCase())) {
        return NextResponse.json({ error: "Topaz job failed", details: statusData }, { status: 502 });
      }
      const delay = Math.min(15000, 2000 + attempt * 500);
      attempt++;
      await new Promise((r) => setTimeout(r, delay));
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


