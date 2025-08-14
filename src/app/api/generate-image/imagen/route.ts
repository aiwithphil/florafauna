import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

const AllowedRatios = [
  "1:1",
  "4:3",
  "16:9",
  "3:4",
  "9:16",
] as const;

const bodySchema = z.object({
  // Allow empty prompt for potential future i2i; enforce for t2i below
  prompt: z.string().optional().default(""),
  ratio: z.enum(AllowedRatios).optional().default("1:1"),
});

export async function POST(req: NextRequest) {
  try {
    const json = await req.json();
    const { prompt, ratio } = bodySchema.parse(json);

    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing GOOGLE_API_KEY on server" },
        { status: 500 }
      );
    }

    const url =
      "https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-preview-06-06:predict";

    // For Imagen, currently no i2i in this route; require non-empty prompt
    if (!prompt || prompt.trim().length === 0) {
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }

    const payload = {
      instances: [
        {
          prompt,
        },
      ],
      parameters: {
        sampleCount: 1,
        aspectRatio: ratio,
      },
    } as const;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `Imagen request failed: ${res.status} ${text}` },
        { status: 502 }
      );
    }

    const data = await res.json();

    // Try a few likely response shapes to extract base64 image bytes
    let b64: string | undefined;
    try {
      b64 = data?.generatedImages?.[0]?.image?.imageBytes;
    } catch {}
    if (!b64) {
      try {
        b64 = data?.predictions?.[0]?.bytesBase64Encoded || data?.predictions?.[0]?.image?.imageBytes;
      } catch {}
    }

    if (!b64) {
      return NextResponse.json(
        { error: "Imagen response missing image bytes" },
        { status: 502 }
      );
    }

    return NextResponse.json({ b64 });
  } catch (error: unknown) {
    console.error("/api/generate-image/imagen error", error);
    return NextResponse.json(
      { error: "Failed to generate image" },
      { status: 500 }
    );
  }
}


