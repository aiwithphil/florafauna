import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

const AllowedRatios = [
  "auto",
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

const AllowedSpeeds = ["DEFAULT", "TURBO"] as const;

const bodySchema = z.object({
  prompt: z.string().min(1),
  ratio: z.enum(AllowedRatios).optional().default("1:1"),
  // Up to 2 character reference images (URL or data URL)
  characterImages: z.array(z.string().min(1)).max(2).optional().default([]),
  // Optional rendering speed
  renderingSpeed: z.enum(AllowedSpeeds).optional().default("DEFAULT"),
});

async function toBlobFromUrlOrDataUrl(input: string): Promise<Blob> {
  if (input.startsWith("data:")) {
    const match = input.match(/^data:([^;]+);base64,(.*)$/);
    if (!match) {
      throw new Error("Invalid data URL format for character image");
    }
    const mime = match[1];
    const b64 = match[2];
    const buf = Buffer.from(b64, "base64");
    return new Blob([buf], { type: mime });
  }
  const res = await fetch(input);
  if (!res.ok) {
    throw new Error(`Failed to fetch character image: ${res.status}`);
  }
  const ab = await res.arrayBuffer();
  const mime = res.headers.get("content-type") || "application/octet-stream";
  return new Blob([ab], { type: mime });
}

export async function POST(req: NextRequest) {
  try {
    const json = await req.json();
    const { prompt, ratio, characterImages, renderingSpeed } = bodySchema.parse(json);

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
    // Only set aspect_ratio if not auto, otherwise let the provider choose
    if (ratio !== "auto") {
      formData.set("aspect_ratio", toIdeogramAspect(ratio));
    }
    formData.set("num_images", "1");
    if (renderingSpeed && renderingSpeed !== "DEFAULT") {
      formData.set("rendering_speed", renderingSpeed);
    }

    if (characterImages && characterImages.length > 0) {
      formData.set("style_type", "AUTO");
      let index = 0;
      for (const src of characterImages) {
        const blob = await toBlobFromUrlOrDataUrl(src);
        const ext = blob.type.includes("png")
          ? "png"
          : blob.type.includes("jpeg") || blob.type.includes("jpg")
          ? "jpg"
          : "bin";
        formData.append("character_reference_images", blob, `character_${index++}.${ext}`);
      }
    }

    const res = await fetch("https://api.ideogram.ai/v1/ideogram-v3/generate", {
      method: "POST",
      headers: {
        "Api-Key": apiKey,
        accept: "application/json",
      } as any,
      body: formData,
    });

    const text = await res.text();
    if (!res.ok) {
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


