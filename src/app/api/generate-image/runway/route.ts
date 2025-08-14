import { NextRequest, NextResponse } from "next/server";
import RunwayML, { type RunwayML as RunwayClient } from "@runwayml/sdk";
import { TaskFailedError } from "@runwayml/sdk";
import { z } from "zod";

export const runtime = "nodejs";

const AllowedRatios = [
  "auto",
  "1:1",
  "16:9",
  "4:3",
  "3:4",
  "9:16",
  "21:9",
] as const;

type AllowedRatio = (typeof AllowedRatios)[number];

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

function mapAspectToRunway(ratio: AllowedRatio): TIAllowedRatio {
  switch (ratio) {
    case "1:1":
      // Requested 1440x1440; use closest supported larger square
      return "1080:1080";
    case "16:9":
      // Requested 1920x1088; use 1920x1080 (closest supported 16:9)
      return "1920:1080";
    case "4:3":
      // Requested 1456x1088; use 1440x1080 (closest supported 4:3)
      return "1440:1080";
    case "3:4":
      // Requested 1088x1456; use 1080x1440 (closest supported 3:4)
      return "1080:1440";
    case "9:16":
      // Requested 1088x1920; use 1080x1920 (closest supported 9:16)
      return "1080:1920";
    case "21:9":
      // Requested 1808x768 is directly supported
      return "1808:768";
    case "auto":
    default:
      return "1024:1024";
  }
}

const bodySchema = z.object({
  // Allow empty prompt for i2i reference mode
  prompt: z.string().optional().default(""),
  ratio: z.enum(AllowedRatios).optional().default("auto"),
  // Up to 3 reference images (URLs or data URIs)
  images: z.array(z.string().min(1)).max(3).optional().default([]),
});

type TaskOutput = { output?: string[] };

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.RUNWAYML_API_SECRET;
    if (!apiKey) {
      return NextResponse.json({ error: "Missing RUNWAYML_API_SECRET on server" }, { status: 500 });
    }

    const json = await req.json();
    const { prompt, ratio, images } = bodySchema.parse(json);

    if (!images || images.length === 0) {
      // No references → require prompt for t2i (even though endpoint uses textToImage API, we enforce UX contract)
      if (!prompt || prompt.trim().length === 0) {
        return NextResponse.json({ error: "Prompt is required when no reference images are provided" }, { status: 400 });
      }
    }

    const client: RunwayClient = new RunwayML({ apiKey });

    const referenceImages = images.slice(0, 3).map((uri, idx) => ({ uri, tag: `ref${idx + 1}` }));

    const task = await client.textToImage
      .create({
        model: "gen4_image_turbo",
        // Use safe prompt: single space allowed when i2i only
        promptText: (prompt && prompt.trim().length > 0) ? prompt : " ",
        ratio: mapAspectToRunway(ratio as AllowedRatio),
        referenceImages,
      })
      .waitForTaskOutput();

    const out = (task as TaskOutput).output;
    const url = Array.isArray(out) ? out[0] : undefined;
    if (!url) {
      return NextResponse.json({ error: "Runway response missing image URL" }, { status: 502 });
    }

    return NextResponse.json({ url });
  } catch (error: unknown) {
    if (error instanceof TaskFailedError) {
      console.error("/api/generate-image/runway task failed", error.taskDetails);
      return NextResponse.json(
        { error: "Generation failed", details: error.taskDetails },
        { status: 502 }
      );
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("/api/generate-image/runway error", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


