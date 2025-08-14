import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { z } from "zod";

export const runtime = "nodejs";

const bodySchema = z.object({
  prompt: z.string().min(1),
  images: z.array(z.string()).optional().default([]),
  model: z.string().optional().default("gpt-4o-mini"),
});

export async function POST(req: NextRequest) {
  try {
    const json = await req.json();
    const { prompt, model, images } = bodySchema.parse(json);

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing OPENAI_API_KEY on server" },
        { status: 500 }
      );
    }

    const client = new OpenAI({ apiKey });

    const hasImages = Array.isArray(images) && images.length > 0;

    const response = await client.responses.create({
      model,
      input: hasImages
        ? [
            {
              role: "user",
              content: [
                { type: "input_text", text: prompt },
                ...images.map((url) => ({ type: "input_image" as const, image_url: url as string, detail: "high" as const })),
              ],
            },
          ]
        : prompt,
    });

    const text = response.output_text ?? "";

    return NextResponse.json({ text });
  } catch (error: unknown) {
    console.error("/api/generate-text error", error);
    return NextResponse.json(
      { error: "Failed to generate text" },
      { status: 500 }
    );
  }
}