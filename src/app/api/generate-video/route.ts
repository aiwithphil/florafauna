import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import RunwayML, { type RunwayML as RunwayClient } from "@runwayml/sdk";
import { TaskFailedError } from "@runwayml/sdk";
import { z } from "zod";

export const runtime = "nodejs";

const AllowedVideoRatios = [
  "1280:720",
  "720:1280",
  "1104:832",
  "832:1104",
  "960:960",
  "1584:672",
] as const;

type AllowedVideoRatio = (typeof AllowedVideoRatios)[number];

type TaskOutput = { output?: string[] };

type TIAllowedRatio =
  | "1920:1080"
  | "1080:1920"
  | "1024:1024"
  | "1360:768"
  | "1080:1080"
  | "1168:880"
  | "1440:1080"
  | "1080:1440"
  | "1808:768"
  | "2112:912"
  | "1280:720"
  | "720:1280"
  | "720:720"
  | "960:720"
  | "720:960"
  | "1680:720";

function mapRatioForTextImage(ratio: AllowedVideoRatio): TIAllowedRatio {
  switch (ratio) {
    case "1280:720":
      return "1280:720";
    case "720:1280":
      return "720:1280";
    case "1104:832":
      return "960:720"; // closest 4:3-ish supported size
    case "832:1104":
      return "720:960";
    case "960:960":
      return "1024:1024";
    case "1584:672":
      return "1680:720"; // widescreen equivalent
    default:
      return "1280:720";
  }
}

const bodySchema = z.object({
  // Allow empty prompt; some providers (Kling) can run without text
  prompt: z.string().optional().default(""),
  duration: z.union([z.literal(5), z.literal(10)]).optional().default(5),
  ratio: z.enum(AllowedVideoRatios).optional().default("1280:720"),
  model: z.enum([
    // Kling
    "Kling 2.1 Master",
    "Kling 2.0 Master",
    "Kling 1.6 Pro",
    // Runway / Topaz
    "Runway Gen 4 Turbo",
    "Runway Act Two",
    "Runway Aleph",
    "Topaz",
  ]).optional().default("Kling 1.6 Pro"),
  images: z.array(z.string().min(1)).optional().default([]),
  videos: z.array(z.string().min(1)).optional().default([]),
  topazScale: z.union([z.literal("2"), z.literal("3"), z.literal("4")]).optional(),
});

export async function POST(req: NextRequest) {
  try {
    // JWT (HS256) helper for Kling auth
    function base64UrlEncode(input: string | Buffer): string {
      const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
      return buf
        .toString("base64")
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
    }
    function createKlingJwt(accessKey: string, secretKey: string): string {
      const header = { alg: "HS256", typ: "JWT" } as const;
      const now = Math.floor(Date.now() / 1000);
      const payload = { iss: accessKey, exp: now + 1800, nbf: now - 5 } as const;
      const encodedHeader = base64UrlEncode(JSON.stringify(header));
      const encodedPayload = base64UrlEncode(JSON.stringify(payload));
      const toSign = `${encodedHeader}.${encodedPayload}`;
      const signature = crypto.createHmac("sha256", secretKey).update(toSign).digest("base64");
      const encodedSignature = signature.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
      return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
    }

    const json = await req.json();
    const { prompt, duration, ratio, model, images, videos, topazScale } = bodySchema.parse(json);

    // Helpers shared by all providers
    function computeOrigin(): string {
      const configured = process.env.PUBLIC_BASE_URL;
      if (configured) return configured.replace(/\/$/, "");
      const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost:3000";
      const proto = req.headers.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
      return `${proto}://${host}`;
    }
    function toPublicDownloadUrlIfDataUrl(input: string, filename: string): string {
      if (!input.startsWith("data:")) return input;
      const origin = computeOrigin();
      return `${origin}/api/download?url=${encodeURIComponent(input)}&filename=${encodeURIComponent(filename)}`;
    }
    function toPublicDownloadUrl(input: string, filename: string): string {
      const origin = computeOrigin();
      return `${origin}/api/download?url=${encodeURIComponent(input)}&filename=${encodeURIComponent(filename)}`;
    }
    function isHttpsUrl(u: string): boolean {
      try {
        const url = new URL(u);
        return url.protocol === "https:";
      } catch {
        return false;
      }
    }

    // Kling integration
    if (model === "Kling 2.1 Master" || model === "Kling 2.0 Master" || model === "Kling 1.6 Pro") {
      const accessKey = process.env.KLING_ACCESS_KEY;
      const secretKey = process.env.KLING_SECRET_KEY;
      const baseUrl = (process.env.KLING_API_BASE_URL || "").replace(/\/$/, "");
      if (!accessKey || !secretKey) {
        return NextResponse.json({ error: "Missing KLING_ACCESS_KEY/KLING_SECRET_KEY on server" }, { status: 500 });
      }
      if (!baseUrl) {
        return NextResponse.json({ error: "Missing KLING_API_BASE_URL on server" }, { status: 500 });
      }

      function mapAllowedRatioToAspectLabel(r: AllowedVideoRatio): string {
        switch (r) {
          case "1280:720":
            return "16:9";
          case "720:1280":
            return "9:16";
          case "1104:832":
            return "4:3";
          case "832:1104":
            return "3:4";
          case "960:960":
            return "1:1";
          case "1584:672":
            return "21:9";
          default:
            return "16:9";
        }
      }

      // If an input image is provided, treat as image-to-video, otherwise text-to-video
      let promptImage = images[0];
      let tailImage = images[1];
      if (promptImage) {
        // Ensure fetchable URL for provider; proxy if needed. Prefer HTTPS when available but do not hard-fail in dev.
        if (promptImage.startsWith("data:")) {
          promptImage = toPublicDownloadUrlIfDataUrl(promptImage, "image.png");
        } else if (promptImage.startsWith("http://")) {
          // Proxy plain HTTP via our download route so the provider can fetch consistently
          promptImage = toPublicDownloadUrl(promptImage, "image.png");
        } else if (!/^https?:\/\//i.test(promptImage)) {
          // If a relative path or unknown scheme sneaks in, make it absolute via our origin
          const origin = computeOrigin();
          promptImage = `${origin}${promptImage.startsWith("/") ? "" : "/"}${promptImage}`;
        }
      }
      if (tailImage) {
        if (tailImage.startsWith("data:")) {
          tailImage = toPublicDownloadUrlIfDataUrl(tailImage, "image_tail.png");
        } else if (tailImage.startsWith("http://")) {
          tailImage = toPublicDownloadUrl(tailImage, "image_tail.png");
        } else if (!/^https?:\/\//i.test(tailImage)) {
          const origin = computeOrigin();
          tailImage = `${origin}${tailImage.startsWith("/") ? "" : "/"}${tailImage}`;
        }
      }

      function mapUiModelToKlingId(label: string): string {
        switch (label) {
          case "Kling 2.1 Master":
            return "kling-v2-1-master";
          case "Kling 2.0 Master":
            return "kling-v2-master";
          case "Kling 1.6 Pro":
          default:
            return "kling-v1-6";
        }
      }

      const klingModel = mapUiModelToKlingId(model);
      const aspectRaw = mapAllowedRatioToAspectLabel(ratio);
      const allowedAspects = new Set(["16:9", "9:16", "1:1"]);
      const aspect = allowedAspects.has(aspectRaw) ? aspectRaw : "16:9";
      const isImageToVideo = Boolean(promptImage);

      // Build payloads expected by Kling endpoints (use model_name per docs; duration as string)
      // Kling accepts empty or missing prompt; send single space when empty to be safe
      const safePrompt = (prompt && String(prompt).trim().length > 0) ? prompt : " ";

      const createPayload: Record<string, unknown> = isImageToVideo
        ? {
            model_name: klingModel,
            prompt: safePrompt,
            aspect_ratio: aspect,
            duration: String(duration as 5 | 10),
            // Kling i2v expects `image` (and optional `image_tail`)
            image: promptImage,
            ...(tailImage ? { image_tail: tailImage } : {}),
            mode: "pro",
          }
        : {
            model_name: klingModel,
            prompt: safePrompt,
            aspect_ratio: aspect,
            duration: String(duration as 5 | 10),
            mode: "pro",
          };

      // Endpoint selection with env overrides
      const t2vPath = (process.env.KLING_T2V_PATH || "/v1/videos/text2video").replace(/\/$/, "");
      const i2vPath = (process.env.KLING_I2V_PATH || "/v1/videos/image2video").replace(/\/$/, "");
      const createPath = isImageToVideo ? i2vPath : t2vPath;
      const createUrl = `${baseUrl}${createPath}`;
      const klingJwt = createKlingJwt(accessKey, secretKey);
      const createResp = await fetch(createUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Kling expects JWT Bearer per docs
          Authorization: `Bearer ${klingJwt}`,
        } as any,
        body: JSON.stringify(createPayload),
      });
      const createText = await createResp.text();
      if (!createResp.ok) {
        return NextResponse.json({ error: `Kling task create failed: ${createResp.status}`, details: createText }, { status: 502 });
      }
      let createData: any;
      try {
        createData = JSON.parse(createText);
      } catch {
        return NextResponse.json({ error: "Invalid JSON from Kling (create)", raw: createText }, { status: 502 });
      }
      const taskId: string | undefined = createData?.task_id || createData?.data?.task_id || createData?.id;
      const hintedStatusUrl: string | undefined =
        createData?.status_url ||
        createData?.data?.status_url ||
        createData?.task_url ||
        createData?.data?.task_url ||
        createData?.result_url ||
        createData?.data?.result_url;
      if (!taskId) {
        return NextResponse.json({ error: "Kling create missing task_id", raw: createData }, { status: 502 });
      }

      // Derive status URL: prefer returned URL; otherwise try env template; otherwise probe common patterns
      const deriveStatusUrl = async (): Promise<string> => {
        if (hintedStatusUrl && /^https?:\/\//i.test(hintedStatusUrl)) return hintedStatusUrl;
        const authHeader = { Authorization: `Bearer ${klingJwt}` } as any;
        const tmpl = process.env.KLING_STATUS_PATH || "/v1/videos/tasks/{task_id}";
        const fromEnv = `${baseUrl}${tmpl.replace("{task_id}", encodeURIComponent(taskId))}`;
        const candidates: string[] = [
          fromEnv,
          `${baseUrl}/v1/videos/task/${encodeURIComponent(taskId)}`,
          `${baseUrl}/v1/videos/tasks?task_id=${encodeURIComponent(taskId)}`,
          `${baseUrl}/v1/tasks/${encodeURIComponent(taskId)}`,
          `${baseUrl}/v1/videos/text2video/${encodeURIComponent(taskId)}`,
          `${baseUrl}/v1/videos/image2video/${encodeURIComponent(taskId)}`,
        ];
        for (const url of candidates) {
          try {
            const resp = await fetch(url, { method: "GET", headers: authHeader });
            if (resp.ok) return url;
          } catch {
            // ignore and try next
          }
        }
        return fromEnv; // fallback to env even if not confirmed
      };

      const statusUrl = await deriveStatusUrl();
      const startedAt = Date.now();
      const timeoutMs = 15 * 60 * 1000; // 15 minutes – Kling jobs can run longer
      let lastStatus: any = null;
      let attempt = 0;
      for (;;) {
        if (Date.now() - startedAt > timeoutMs) {
          return NextResponse.json({ error: "Kling task timed out", details: lastStatus }, { status: 504 });
        }
        const sResp = await fetch(statusUrl, {
          headers: {
            Authorization: `Bearer ${klingJwt}`,
          } as any,
        });
        const sText = await sResp.text();
        if (!sResp.ok) {
          return NextResponse.json({ error: `Kling status failed: ${sResp.status}`, details: sText }, { status: 502 });
        }
        let sData: any;
        try {
          sData = JSON.parse(sText);
        } catch {
          return NextResponse.json({ error: "Invalid JSON from Kling (status)", raw: sText }, { status: 502 });
        }
        lastStatus = sData;

        const state: string | undefined =
          sData?.data?.task_status || sData?.task_status || sData?.status || sData?.data?.status;
        if (state && ["succeed", "succeeded", "finished", "success", "completed"].includes(state.toLowerCase())) {
          // Extract first video URL from common Kling shapes
          const urlCandidates: Array<string | undefined> = [
            sData?.data?.task_result?.videos?.[0]?.url,
            sData?.task_result?.videos?.[0]?.url,
            sData?.result?.video_url,
            sData?.data?.result?.video_url,
            sData?.data?.output?.[0],
            sData?.output?.[0],
            sData?.url,
            sData?.data?.url,
          ];
          const url = urlCandidates.find((u): u is string => typeof u === "string" && /^https?:\/\//i.test(u));
          return NextResponse.json({ url });
        }
        if (state && ["failed", "error", "canceled", "cancelled"].includes(state.toLowerCase())) {
          return NextResponse.json({ error: "Kling task failed", details: sData }, { status: 502 });
        }
        // Use slower backoff while processing per docs (avoid rate limits)
        const delay = state && state.toLowerCase() === "processing"
          ? Math.min(15000, 3000 + attempt * 1000)
          : Math.min(10000, 2000 + attempt * 500);
        attempt++;
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    function toFetchableUrl(input: string | undefined): string | undefined {
      if (!input) return undefined;
      // Pass through original URL or data URI untouched; some providers return data URIs which Runway accepts.
      return input;
    }

    async function uploadAssetFromInput(client: RunwayClient, input: string): Promise<string> {
      try {
        let mime = "application/octet-stream";
        let buf: Buffer | null = null;
        if (input.startsWith("data:")) {
          const match = input.match(/^data:([^;]+);base64,(.*)$/);
          if (!match) throw new Error("Invalid data URL");
          mime = match[1];
          buf = Buffer.from(match[2], "base64");
        } else {
          const res = await fetch(input);
          if (!res.ok) throw new Error(`Failed to fetch asset: ${res.status}`);
          const ab = await res.arrayBuffer();
          buf = Buffer.from(ab);
          mime = res.headers.get("content-type") || mime;
        }

        const anyClient = client as unknown as { assets?: { upload?: (arg: any) => Promise<any>, create?: (arg: any) => Promise<any> } };
        const fileBlob = new Blob([buf!], { type: mime });
        let uploaded: any | undefined;
        if (anyClient.assets?.upload) {
          uploaded = await anyClient.assets.upload({ file: fileBlob });
        } else if (anyClient.assets?.create) {
          uploaded = await anyClient.assets.create({ file: fileBlob });
        }
        const candidate = uploaded?.url || uploaded?.asset?.url || uploaded?.data?.url || uploaded?.asset_url || uploaded?.assetUrl;
        return typeof candidate === "string" && candidate.length > 0 ? candidate : input;
      } catch {
        return input;
      }
    }

    // Runway integration starts here
    const runwayApiKey = process.env.RUNWAYML_API_SECRET;

    // If using Runway models below, ensure key is present
    if ((model?.startsWith && model.startsWith("Runway ")) && !runwayApiKey) {
      return NextResponse.json({ error: "Missing RUNWAYML_API_SECRET on server" }, { status: 500 });
    }
    const client: RunwayClient = new RunwayML({ apiKey: runwayApiKey ?? "" });

    async function ensureHttpsAssetUrl(input: string, filename: string): Promise<string | null> {
      // If already HTTPS, accept as-is
      if (typeof input === "string" && input.startsWith("https://")) return input;

      // Try uploading to Runway assets first
      const uploaded = await uploadAssetFromInput(client, input);
      if (uploaded && isHttpsUrl(uploaded)) return uploaded;

      // If data URL, fall back to proxy if origin is HTTPS
      if (input.startsWith("data:")) {
        const origin = computeOrigin();
        if (origin.startsWith("https://")) {
          return toPublicDownloadUrlIfDataUrl(input, filename);
        }
        return null;
      }

      // If plain HTTP URL, proxy only if our origin is HTTPS
      if (input.startsWith("http://")) {
        const origin = computeOrigin();
        if (origin.startsWith("https://")) {
          return toPublicDownloadUrl(input, filename);
        }
        return null;
      }

      // Unknown scheme; reject
      return null;
    }

    // Route by model
    if (model === "Runway Gen 4 Turbo") {
      // Requires image input; use the first provided image
      let promptImage = toFetchableUrl(images[0]);
      if (!promptImage) {
        return NextResponse.json({ error: "Runway Gen 4 Turbo requires an input image" }, { status: 400 });
      }
      // Ensure the image URL is HTTPS (upload or proxy if needed)
      const ensuredImage = await ensureHttpsAssetUrl(promptImage, "image.png");
      if (!ensuredImage) {
        return NextResponse.json({ error: "Only HTTPS URLs are allowed for promptImage. Set PUBLIC_BASE_URL to an https origin or try a different source." }, { status: 400 });
      }
      promptImage = ensuredImage;
      const params: any = {
        model: "gen4_turbo",
        promptImage,
        imageUri: promptImage,
        promptText: prompt,
        publicFigureThreshold: "low",
        ratio: ratio as AllowedVideoRatio,
        duration: duration as 5 | 10,
      };
      const videoTask = await client.imageToVideo.create(params).waitForTaskOutput();
      const videoOutput = (videoTask as TaskOutput).output;
      const url = Array.isArray(videoOutput) ? videoOutput[0] : undefined;
      return NextResponse.json({ url });
    }

    if (model === "Runway Act Two") {
      // Requires one image and one video
      let promptImage = toFetchableUrl(images[0]);
      let promptVideo = toFetchableUrl(videos[0]);
      if (!promptImage || !promptVideo) {
        return NextResponse.json({ error: "Runway Act Two requires one image and one video input" }, { status: 400 });
      }
      const ensuredActTwoImage = await ensureHttpsAssetUrl(promptImage, "image.png");
      if (!ensuredActTwoImage) {
        return NextResponse.json({ error: "Only HTTPS URLs are allowed for promptImage. Set PUBLIC_BASE_URL to an https origin or try a different source." }, { status: 400 });
      }
      promptImage = ensuredActTwoImage;
      const ensuredActTwoVideo = await ensureHttpsAssetUrl(promptVideo, "video.mp4");
      if (!ensuredActTwoVideo) {
        return NextResponse.json({ error: "Only HTTPS URLs are allowed for promptVideo. Set PUBLIC_BASE_URL to an https origin or try a different source." }, { status: 400 });
      }
      promptVideo = ensuredActTwoVideo;
      const actTwoParams: any = {
        model: "act_two",
        promptImage,
        imageUri: promptImage,
        promptVideo,
        videoUri: promptVideo,
        promptText: prompt,
        publicFigureThreshold: "low",
        ratio: ratio as AllowedVideoRatio,
        duration: duration as 5 | 10,
      };
      const videoTask = await client.videoToVideo.create(actTwoParams).waitForTaskOutput();
      const videoOutput = (videoTask as TaskOutput).output;
      const url = Array.isArray(videoOutput) ? videoOutput[0] : undefined;
      return NextResponse.json({ url });
    }

    if (model === "Runway Aleph") {
      // Requires one video
      let promptVideo = toFetchableUrl(videos[0]);
      if (!promptVideo) {
        return NextResponse.json({ error: "Runway Aleph requires a video input" }, { status: 400 });
      }
      const ensuredAlephVideo = await ensureHttpsAssetUrl(promptVideo, "video.mp4");
      if (!ensuredAlephVideo) {
        return NextResponse.json({ error: "Only HTTPS URLs are allowed for promptVideo. Set PUBLIC_BASE_URL to an https origin or try a different source." }, { status: 400 });
      }
      promptVideo = ensuredAlephVideo;
      const alephParams: any = {
        model: "gen4_aleph",
        promptVideo,
        videoUri: promptVideo,
        promptText: prompt,
        publicFigureThreshold: "low",
        ratio: ratio as AllowedVideoRatio,
        duration: 5,
      };
      const videoTask = await client.videoToVideo.create(alephParams).waitForTaskOutput();
      const videoOutput = (videoTask as TaskOutput).output;
      const url = Array.isArray(videoOutput) ? videoOutput[0] : undefined;
      return NextResponse.json({ url });
    }

    if (model === "Topaz") {
      // Requires one video input; optionally use scale to influence output resolution
      const promptVideo = videos[0];
      if (!promptVideo) {
        return NextResponse.json({ error: "Topaz requires a video input" }, { status: 400 });
      }
      // For Topaz, compute output size from scale if possible; if ratio is known, we may ignore here
      let outputWidth: number | undefined;
      let outputHeight: number | undefined;
      const desiredScale = Number(topazScale || 2);
      try {
        // We cannot probe dimensions server-side reliably without fetching; Topaz can infer. Keep undefined.
      } catch {}
      const origin = computeOrigin();
      const proxyVideo = promptVideo.startsWith("data:") ? promptVideo : toPublicDownloadUrl(promptVideo, "video.mp4");
      const topazResp = await fetch(`${origin}/api/generate-video/topaz`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          video: proxyVideo,
          output_width: outputWidth,
          output_height: outputHeight,
          scale: String(desiredScale),
        }),
      });
      const topazJson = await topazResp.json();
      if (!topazResp.ok) {
        return NextResponse.json({ error: topazJson?.error || "Topaz failed", details: topazJson }, { status: 502 });
      }
      return NextResponse.json({ url: topazJson?.url });
    }

    return NextResponse.json({ error: "Unsupported model" }, { status: 400 });
  } catch (error: unknown) {
    if (error instanceof TaskFailedError) {
      console.error("/api/generate-video task failed", error.taskDetails);
      return NextResponse.json(
        { error: "Generation failed", details: error.taskDetails },
        { status: 502 }
      );
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("/api/generate-video error", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


