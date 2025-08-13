import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

const AllowedRatios = [
  "1:1",
  "16:9",
  "4:3",
  "3:4",
  "9:16",
] as const;

const bodySchema = z.object({
  prompt: z.string().min(1),
  model: z.string().optional().default("Flux Dev"),
  ratio: z.enum(AllowedRatios).default("1:1"),
});

function mapModelToPath(model: string): string {
  // Minimal mapping for supported labels in the UI
  switch (model) {
    case "Flux Dev":
      return "/flux-dev";
    case "Flux Kontext Max":
      return "/flux-kontext-max";
    case "Flux Pro 1.1":
      return "/flux-pro-1.1";
    default:
      return "/flux-dev";
  }
}

export async function POST(req: NextRequest) {
  try {
    const json = await req.json();
    const { prompt, model, ratio } = bodySchema.parse(json);

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
        case "1:1":
          return { width: 1024, height: 1024 };
        case "16:9":
          // Use multiples of 64 for compatibility
          return { width: 1024, height: 576 };
        case "4:3":
          return { width: 1024, height: 768 };
        case "3:4":
          return { width: 768, height: 1024 };
        case "9:16":
          // Use multiples of 64 for compatibility
          return { width: 576, height: 1024 };
        default:
          return { width: 1024, height: 1024 };
      }
    }

    const { width, height } = dimsForRatio(ratio);

    const submitRes = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-key": apiKey,
      },
      body: JSON.stringify({
        prompt,
        aspect_ratio: ratio,
        width,
        height,
      }),
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
    // eslint-disable-next-line no-constant-condition
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


