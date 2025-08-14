import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

const AllowedRatios = [
  // Allow "auto" specifically for i2i (e.g., Flux Kontext Max)
  "auto",
  "1:1",
  "21:9",
  "16:9",
  "4:3",
  "3:2",
  "3:4",
  "2:3",
  "9:16",
  "9:21",
] as const;

const bodySchema = z.object({
  // Allow empty prompt for i2i
  prompt: z.string().optional().default(""),
  model: z.string().optional().default("Flux Dev"),
  ratio: z.enum(AllowedRatios).default("1:1"),
  // Optional input/reference images for image-to-image workflows
  images: z.array(z.string().min(1)).max(10).optional().default([]),
});

function mapModelToPath(model: string): string {
  // Minimal mapping for supported labels in the UI
  switch (model) {
    case "Flux Dev":
      return "/flux-dev";
    case "Flux Kontext Max":
      return "/flux-kontext-max";
    case "Flux Pro 1.1":
      // Upgrade standard Pro 1.1 to Ultra endpoint
      return "/flux-pro-1.1-ultra";
    case "Flux Pro 1.1 Ultra":
      return "/flux-pro-1.1-ultra";
    default:
      return "/flux-dev";
  }
}

export async function POST(req: NextRequest) {
  try {
    const json = await req.json();
    const { prompt, model, ratio, images } = bodySchema.parse(json);

    const apiKey = process.env.BFL_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing BFL_API_KEY on server" },
        { status: 500 }
      );
    }

    const baseUrl = "https://api.bfl.ai/v1";
    const path = mapModelToPath(model);

    function dimsForRatio(r: typeof AllowedRatios[number]): { width: number; height: number } {
      switch (r) {
        case "auto":
          // Placeholder; caller should omit width/height when auto
          return { width: 1024, height: 1024 };
        case "1:1":
          return { width: 1024, height: 1024 };
        case "21:9":
          // Multiples of 64; ultra-wide
          return { width: 1344, height: 576 };
        case "16:9":
          // Use multiples of 64 for compatibility
          return { width: 1024, height: 576 };
        case "4:3":
          return { width: 1024, height: 768 };
        case "3:2":
          // Higher total pixels but within typical limits
          return { width: 1536, height: 1024 };
        case "3:4":
          return { width: 768, height: 1024 };
        case "2:3":
          return { width: 1024, height: 1536 };
        case "9:16":
          // Use multiples of 64 for compatibility
          return { width: 576, height: 1024 };
        case "9:21":
          // Ultra-tall
          return { width: 576, height: 1344 };
        default:
          return { width: 1024, height: 1024 };
      }
    }

    // Base dimensions (not used if ratio === "auto")
    let { width, height } = dimsForRatio(ratio);

    // Override sizes ONLY for Flux Dev per requested mappings
    if (model === "Flux Dev" && ratio !== "auto") {
      switch (ratio) {
        case "1:1":
          width = 1440;
          height = 1440;
          break;
        case "16:9":
          width = 1440;
          height = 800;
          break;
        case "4:3":
          width = 1440;
          height = 1088;
          break;
        case "3:4":
          width = 1088;
          height = 1440;
          break;
        case "9:16":
          width = 800;
          height = 1440;
          break;
        default:
          // Leave other ratios as initially computed
          break;
      }
    }

    // For Flux Pro 1.1 / Ultra, target ~2x dimensions while respecting a ~4MP ceiling
    // Reference: FLUX1.1 [pro] Ultra docs (up to 4MP) https://docs.bfl.ai/flux_models/flux_1_1_pro_ultra_raw
    if ((model === "Flux Pro 1.1" || model === "Flux Pro 1.1 Ultra") && ratio !== "auto") {
      // Default: double both dimensions
      let nextW = width * 2;
      let nextH = height * 2;

      // Cap to ~4MP where needed, preserving aspect and multiples of 64
      // Pre-calculate known caps for ratios that would exceed 4MP when doubled
      // 3:2 => 2304x1536 (≈3.54MP), 2:3 => 1536x2304 (≈3.54MP)
      if (ratio === "3:2") {
        nextW = 2304;
        nextH = 1536;
      } else if (ratio === "2:3") {
        nextW = 1536;
        nextH = 2304;
      }

      width = nextW;
      height = nextH;
    }

    // Build request body
    type FluxPayload = {
      prompt: string;
      aspect_ratio?: string;
      width?: number;
      height?: number;
      image_url?: string;
      image_urls?: string[];
      // Kontext i2i specific
      input_image?: string; // base64-encoded image bytes (no data URL prefix)
      resolution_mode?: "auto" | "match_input";
    };
    // Some Flux endpoints may accept empty prompt with i2i; use single space when empty to be safe for i2i
    const safePrompt = (prompt && prompt.trim().length > 0) ? prompt : " ";
    const payload: FluxPayload = { prompt: safePrompt };

    // Helper to turn URL or data URL into base64 string
    async function toBase64FromUrlOrDataUrl(input: string): Promise<{ b64: string; mime: string }> {
      if (input.startsWith("data:")) {
        const match = input.match(/^data:([^;]+);base64,(.*)$/);
        if (!match) throw new Error("Invalid data URL format for input image");
        return { mime: match[1], b64: match[2] };
      }
      const res = await fetch(input);
      if (!res.ok) throw new Error(`Failed to fetch input image: ${res.status}`);
      const ab = await res.arrayBuffer();
      const mime = res.headers.get("content-type") || "application/octet-stream";
      const b64 = Buffer.from(ab).toString("base64");
      return { b64, mime };
    }

    const isKontext = model === "Flux Kontext Max";
    const hasI2I = Array.isArray(images) && images.length > 0;

    if (hasI2I && isKontext) {
      // For Kontext i2i, send base64 input_image
      const { b64 } = await toBase64FromUrlOrDataUrl(images[0]);
      payload.input_image = b64;
      if (ratio === "auto") {
        // Follow the source dimensions
        payload.resolution_mode = "match_input";
      } else {
        // Respect user's chosen size: switch to auto resolution and provide aspect/dims
        payload.resolution_mode = "auto";
        payload.aspect_ratio = ratio;
        // Provide concrete dims as a hint if supported
        const dims = dimsForRatio(ratio);
        payload.width = dims.width;
        payload.height = dims.height;
      }
    } else {
      // Standard t2i flow (and non-Kontext models)
      if (ratio !== "auto") {
        Object.assign(payload, {
          aspect_ratio: ratio,
          width,
          height,
        });
      }
      if (hasI2I) {
        if (images.length === 1) {
          payload.image_url = images[0];
        } else {
          payload.image_urls = images.slice(0, 10);
        }
      }
    }

    // If no images were provided (pure t2i), require non-empty prompt
    if (!hasI2I && (!prompt || prompt.trim().length === 0)) {
      return NextResponse.json(
        { error: "Prompt is required when no input images are provided" },
        { status: 400 }
      );
    }

    const submitRes = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-key": apiKey,
      },
      body: JSON.stringify(payload),
    });

    if (!submitRes.ok) {
      const text = await submitRes.text();
      return NextResponse.json(
        { error: `Submit failed: ${submitRes.status}`, details: text },
        { status: 500 }
      );
    }

    const submitJson = (await submitRes.json()) as {
      id?: string;
      polling_url?: string;
    };

    const pollingUrl = submitJson.polling_url;
    if (!pollingUrl) {
      return NextResponse.json(
        { error: "Missing polling_url from BFL response" },
        { status: 500 }
      );
    }

    // Poll until ready
    const startedAt = Date.now();
    const timeoutMs = 90_000; // 90s max
    let lastStatus = "";
    while (true) {
      if (Date.now() - startedAt > timeoutMs) {
        return NextResponse.json(
          { error: `Timed out waiting for result. Last status: ${lastStatus}` },
          { status: 504 }
        );
      }

      await new Promise((r) => setTimeout(r, 600));

      const pollRes = await fetch(pollingUrl, {
        method: "GET",
        headers: {
          accept: "application/json",
          "x-key": apiKey,
        },
      });

      if (!pollRes.ok) {
        const text = await pollRes.text();
        return NextResponse.json(
          { error: `Polling failed: ${pollRes.status}`, details: text },
          { status: 502 }
        );
      }

      const pollJson = (await pollRes.json()) as {
        status?: string;
        result?: { sample?: string } | null;
        error?: unknown;
      };
      lastStatus = pollJson.status ?? "";

      if (lastStatus === "Ready") {
        const url = pollJson.result?.sample;
        if (!url) {
          return NextResponse.json(
            { error: "No sample URL in Ready result" },
            { status: 500 }
          );
        }
        return NextResponse.json({ url });
      }
      if (lastStatus === "Error" || lastStatus === "Failed") {
        return NextResponse.json(
          { error: "Generation failed", details: pollJson },
          { status: 500 }
        );
      }
    }
  } catch (error: unknown) {
    console.error("/api/generate-image/flux error", error);
    return NextResponse.json(
      { error: "Failed to generate image" },
      { status: 500 }
    );
  }
}


