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
  prompt: z.string().min(1),
  size: z.enum(AllowedSizes).optional().default("1024x1024"),
});

export async function POST(req: NextRequest) {
  try {
    const json = await req.json();
    const { prompt, size } = bodySchema.parse(json);

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing OPENAI_API_KEY on server" },
        { status: 500 }
      );
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