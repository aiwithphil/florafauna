import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { z } from "zod";

export const runtime = "nodejs";

const AllowedSizes = [
  "1024x1024",
  "1536x1024",
  "1024x1536",
  "auto",
] as const;

type AllowedSize = (typeof AllowedSizes)[number];

const bodySchema = z.object({
  // Allow empty prompt for image-to-image flows
  prompt: z.string().optional().default(""),
  size: z.enum(AllowedSizes).optional().default("1024x1024"),
  // Optional array of image URLs or data URLs for image-to-image/reference guidance
  images: z.array(z.string().min(1)).max(10).optional().default([]),
});

export async function POST(req: NextRequest) {
  try {
    const json = await req.json();
    const { prompt, size, images } = bodySchema.parse(json);

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing OPENAI_API_KEY on server" },
        { status: 500 }
      );
    }

    // If there are reference/input images, call image edit/reference API via multipart
    if (images && images.length > 0) {
      async function toBlobFromUrlOrDataUrl(input: string): Promise<Blob> {
        if (input.startsWith("data:")) {
          // data URL case
          const match = input.match(/^data:([^;]+);base64,(.*)$/);
          if (!match) {
            throw new Error("Invalid data URL format");
          }
          const mime = match[1];
          const b64 = match[2];
          const buf = Buffer.from(b64, "base64");
          return new Blob([buf], { type: mime });
        }
        // Remote URL case
        const res = await fetch(input);
        if (!res.ok) {
          throw new Error(`Failed to fetch reference image: ${res.status}`);
        }
        const ab = await res.arrayBuffer();
        const mime = res.headers.get("content-type") || "application/octet-stream";
        return new Blob([ab], { type: mime });
      }

      const form = new FormData();
      form.set("model", "gpt-image-1");
      // Some providers require a non-empty prompt even for i2i; use a single space when empty
      const safePrompt = (prompt && prompt.trim().length > 0) ? prompt : " ";
      form.set("prompt", safePrompt);
      if (size && size !== "auto") form.set("size", size as string);
      // Attach up to 10 images as image[] entries
      const limited = images.slice(0, 10);
      let index = 0;
      for (const url of limited) {
        const blob = await toBlobFromUrlOrDataUrl(url);
        // Filename hints mime, but not required
        const ext = (blob.type && blob.type.includes("png")) ? "png" : (blob.type && blob.type.includes("jpeg")) ? "jpg" : "bin";
        form.append("image[]", blob, `image_${index++}.${ext}`);
      }

      const resp = await fetch("https://api.openai.com/v1/images/edits", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          // Do not set Content-Type; let fetch set multipart boundary
        } as any,
        body: form,
      });

      const text = await resp.text();
      if (!resp.ok) {
        return NextResponse.json(
          { error: `OpenAI image edit failed: ${resp.status}`, details: text },
          { status: 502 }
        );
      }
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        return NextResponse.json({ error: "Invalid JSON from OpenAI", raw: text }, { status: 502 });
      }
      const first = data?.data?.[0];
      const imageUrl = first?.url as string | undefined;
      const b64 = first?.b64_json as string | undefined;
      return NextResponse.json({ url: imageUrl, b64 });
    }

    // Otherwise, standard text-to-image generation
    // Require a non-empty prompt for pure text-to-image
    if (!prompt || prompt.trim().length === 0) {
      return NextResponse.json({ error: "Prompt is required when no input images are provided" }, { status: 400 });
    }
    const client = new OpenAI({ apiKey });
    const result = await client.images.generate({
      model: "gpt-image-1",
      prompt,
      size: size as AllowedSize,
    });
    const data = result.data?.[0];
    const imageUrl = data?.url;
    const b64 = data?.b64_json;
    return NextResponse.json({ url: imageUrl, b64 });
  } catch (error: unknown) {
    console.error("/api/generate-image error", error);
    return NextResponse.json(
      { error: "Failed to generate image" },
      { status: 500 }
    );
  }
}