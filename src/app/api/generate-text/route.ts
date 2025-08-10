import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { z } from "zod";

export const runtime = "nodejs";

const bodySchema = z.object({
  prompt: z.string().min(1),
  model: z.string().optional().default("gpt-4o-mini"),
});

export async function POST(req: NextRequest) {
  try {
    const json = await req.json();
    const { prompt, model } = bodySchema.parse(json);

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing OPENAI_API_KEY on server" },
        { status: 500 }
      );
    }

    const client = new OpenAI({ apiKey });

    const response = await client.responses.create({
      model,
      input: prompt,
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