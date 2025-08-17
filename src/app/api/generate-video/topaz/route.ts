import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
// GET /api/generate-video/topaz?status=1&id=VIDEO_ID
export async function GET(req: NextRequest) {
  const apiKey = process.env.TOPAZ_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Missing TOPAZ_API_KEY on server" }, { status: 500 });
  }
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  const resp = await fetch(`https://api.topazlabs.com/video/${encodeURIComponent(id)}/status`, {
    headers: { accept: "application/json", "X-API-Key": apiKey },
  });
  const text = await resp.text();
  if (!resp.ok) return NextResponse.json({ error: `Topaz status failed: ${resp.status}`, details: text }, { status: 502 });
  let data: any; try { data = JSON.parse(text); } catch { data = {}; }
  const state: string | undefined = data?.status || data?.data?.status;
  const done = state && ["completed", "complete", "succeeded", "finished", "success"].includes(state.toLowerCase());
  const failed = state && ["failed", "error", "canceled", "cancelled"].includes(state.toLowerCase());
  const candidates: Array<string | undefined> = [
    data?.downloadUrl,
    data?.outputUrl,
    data?.data?.downloadUrl,
    data?.data?.outputUrl,
    data?.url,
    data?.data?.url,
    data?.download?.url,
    data?.data?.download?.url,
    // Other possible shapes
    data?.result?.url,
    data?.result?.video_url,
    data?.data?.result?.url,
    data?.data?.result?.video_url,
    data?.output?.url,
    data?.output?.downloadUrl,
    data?.outputs?.[0]?.url,
    data?.outputs?.[0]?.downloadUrl,
  ];
  const url = candidates.find((u) => typeof u === "string" && /^https?:\/\//i.test(u!));
  const download = data?.download || data?.data?.download || (url ? { url } : undefined);
  return NextResponse.json({ state, done: Boolean(done), failed: Boolean(failed), url, download });
}

const bodySchema = z.object({
  video: z.string().min(1), // URL or data URL
  output_width: z.number().int().positive().optional(),
  output_height: z.number().int().positive().optional(),
  scale: z.union([z.literal("2"), z.literal("3"), z.literal("4")]).optional(),
  // Optional source metadata if known
  source_width: z.number().int().positive().optional(),
  source_height: z.number().int().positive().optional(),
  source_duration: z.number().positive().optional(),
  source_frame_rate: z.number().positive().optional(),
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
    let { video, output_width, output_height, scale, source_width, source_height, source_duration, source_frame_rate } = parsed;

    // Compute base values for output resolution
    const sNum = Math.max(2, Math.min(4, Number(scale || 2)));
    const defaultOutW = typeof output_width === "number" ? output_width : (typeof source_width === "number" ? Math.round(source_width * sNum) : 1280);
    const defaultOutH = typeof output_height === "number" ? output_height : (typeof source_height === "number" ? Math.round(source_height * sNum) : 720);

    // Prepare create payload. Always include required output fields.
    const createPayload: Record<string, unknown> = {
      output: {
        resolution: { width: defaultOutW, height: defaultOutH },
        frameRate: 30,
        audioTransfer: "Copy",
        audioCodec: "AAC",
        dynamicCompressionLevel: "Low",
        container: "mp4",
      },
      // At least one filter is required by the API. Use a stable default model.
      filters: [{ model: "iris-3" }],
    };

    // Fetch the source now so we can provide accurate size in the create payload
    const { buffer, mime } = await toBufferFromUrlOrDataUrl(video);

    // Step 1: Create request — build full payload with required fields from error
    // Fill required source metadata when possible; if missing, use safe defaults
    const inferredDuration = typeof source_duration === "number" ? Math.max(1, Math.round(source_duration)) : 5;
    const inferredFrameRate = typeof source_frame_rate === "number" ? Math.max(1, Math.round(source_frame_rate)) : 30;
    const inferredFrameCount = Math.max(1, Math.round(inferredFrameRate * inferredDuration));
    const source = {
      container: "mp4",
      size: Math.max(1, buffer.length),
      duration: inferredDuration,
      frameCount: inferredFrameCount,
      frameRate: inferredFrameRate,
      resolution: {
        width: typeof source_width === "number" ? source_width : (typeof output_width === "number" ? output_width : 1280),
        height: typeof source_height === "number" ? source_height : (typeof output_height === "number" ? output_height : 720),
      },
    };

    let createResp: Response;
    try {
      createResp = await fetch("https://api.topazlabs.com/video/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          accept: "application/json",
          "X-API-Key": apiKey,
        },
        body: JSON.stringify({ ...createPayload, source }),
      });
    } catch (e: any) {
      return NextResponse.json({ error: "Topaz create network error", cause: e?.message || String(e) }, { status: 502 });
    }
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
    let acceptResp: Response;
    try {
      acceptResp = await fetch(`https://api.topazlabs.com/video/${encodeURIComponent(requestId)}/accept`, {
        method: "PATCH",
        headers: { accept: "application/json", "X-API-Key": apiKey },
      });
    } catch (e: any) {
      return NextResponse.json({ error: "Topaz accept network error", cause: e?.message || String(e) }, { status: 502 });
    }
    const acceptText = await acceptResp.text();
    if (!acceptResp.ok) {
      return NextResponse.json({ error: `Topaz accept failed: ${acceptResp.status}`, details: acceptText }, { status: 502 });
    }
    let acceptData: any;
    try { acceptData = JSON.parse(acceptText); } catch { acceptData = {}; }
    // Handle multiple response shapes from Topaz
    const uploadUrls: Array<any> = acceptData?.uploadUrls || acceptData?.data?.uploadUrls || [];
    let singleUrl: string | undefined = acceptData?.uploadUrl || acceptData?.data?.uploadUrl;
    let partNum: number = 1;
    if (!singleUrl && Array.isArray(uploadUrls) && uploadUrls.length > 0) {
      singleUrl = uploadUrls[0]?.url || uploadUrls[0];
      partNum = uploadUrls[0]?.partNum || 1;
    }
    // Some environments return a plain `urls: string[]`
    if (!singleUrl && Array.isArray(acceptData?.urls) && acceptData.urls.length > 0) {
      singleUrl = acceptData.urls[0];
    }
    if (!singleUrl) {
      return NextResponse.json({ error: "Topaz accept missing upload URL", raw: acceptData }, { status: 502 });
    }

    // Step 3: Upload source video (single-part for now) – reuse the buffer
    let putResp: Response;
    try {
      putResp = await fetch(singleUrl, {
        method: "PUT",
        headers: { "Content-Type": mime },
        body: buffer,
      });
    } catch (e: any) {
      return NextResponse.json({ error: "Topaz upload network error", cause: e?.message || String(e), url: singleUrl?.slice(0, 64) + "…" }, { status: 502 });
    }
    if (!putResp.ok) {
      const t = await putResp.text().catch(() => "");
      return NextResponse.json({ error: `Topaz upload failed: ${putResp.status}`, details: t }, { status: 502 });
    }
    const eTag = putResp.headers.get("etag") || putResp.headers.get("ETag") || "";

    // Step 4: Complete upload
    let completeResp: Response;
    try {
      completeResp = await fetch(`https://api.topazlabs.com/video/${encodeURIComponent(requestId)}/complete-upload`, {
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
          // Support alternate contract with uploadId/parts
          uploadId: acceptData?.uploadId || acceptData?.data?.uploadId,
          parts: [
            { partNumber: partNum, eTag: eTag },
          ],
        }),
      });
    } catch (e: any) {
      return NextResponse.json({ error: "Topaz complete-upload network error", cause: e?.message || String(e) }, { status: 502 });
    }
    const completeText = await completeResp.text();
    if (!completeResp.ok) {
      return NextResponse.json({ error: `Topaz complete-upload failed: ${completeResp.status}`, details: completeText }, { status: 502 });
    }

    // Return async job id for a separate status poll endpoint
    return NextResponse.json({ jobId: requestId });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


