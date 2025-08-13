import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

const AllowedRatios = [
  "1:1",
  "3:1",
  "16:10",
  "16:9",
  "3:2",
  "4:3",
  "3:4",
  "2:3",
  "9:16",
  "10:16",
  "1:3",
] as const;

const bodySchema = z.object({
  prompt: z.string().min(1),
  ratio: z.enum(AllowedRatios).optional().default("1:1"),
});

export async function POST(req: NextRequest) {
  try {
    const json = await req.json();
    const { prompt, ratio } = bodySchema.parse(json);

    const apiKey = process.env.IDEOGRAM_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing IDEOGRAM_API_KEY on server" },
        { status: 500 }
      );
    }

    const toIdeogramAspect = (r: typeof AllowedRatios[number]): string => r.replace(":", "x");
    const formData = new FormData();
    formData.set("prompt", prompt);
    formData.set("aspect_ratio", toIdeogramAspect(ratio));
    formData.set("num_images", "1");
    // Leave rendering_speed default (DEFAULT). If needed, set: formData.set("rendering_speed", "TURBO");

    const res = await fetch("https://api.ideogram.ai/v1/ideogram-v3/generate", {
      method: "POST",
      headers: {
        "Api-Key": apiKey,
        accept: "application/json",
        // Do not set Content-Type explicitly; let fetch set the multipart boundary
      } as any,
      body: formData,
    });

    const text = await res.text();
    if (!res.ok) {
      // Forward upstream status when possible
      return NextResponse.json(
        { error: `Ideogram request failed: ${res.status}`, details: text },
        { status: res.status }
      );
    }

    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON from Ideogram", raw: text },
        { status: 502 }
      );
    }

    const first = data?.data?.[0];
    const url: string | undefined = first?.url;
    if (!url) {
      return NextResponse.json(
        { error: "Ideogram response missing image URL", details: data },
        { status: 502 }
      );
    }

    return NextResponse.json({ url });
  } catch (error: unknown) {
    console.error("/api/generate-image/ideogram error", error);
    return NextResponse.json(
      { error: "Failed to generate image" },
      { status: 500 }
    );
  }
}


