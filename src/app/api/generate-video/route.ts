import { NextRequest, NextResponse } from "next/server";
import RunwayML, { type RunwayML as RunwayClient } from "@runwayml/sdk";
import { TaskFailedError } from "@runwayml/sdk";
import { z } from "zod";

export const runtime = "nodejs";

const AllowedVideoRatios = [
  "1280:720",
  "720:1280",
  "1104:832",
  "832:1104",
  "960:960",
  "1584:672",
] as const;

type AllowedVideoRatio = (typeof AllowedVideoRatios)[number];

type TaskOutput = { output?: string[] };

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

function mapRatioForTextImage(ratio: AllowedVideoRatio): TIAllowedRatio {
  switch (ratio) {
    case "1280:720":
      return "1280:720";
    case "720:1280":
      return "720:1280";
    case "1104:832":
      return "960:720"; // closest 4:3-ish supported size
    case "832:1104":
      return "720:960";
    case "960:960":
      return "1024:1024";
    case "1584:672":
      return "1680:720"; // widescreen equivalent
    default:
      return "1280:720";
  }
}

const bodySchema = z.object({
  prompt: z.string().min(1),
  duration: z.union([z.literal(5), z.literal(10)]).optional().default(5),
  ratio: z.enum(AllowedVideoRatios).optional().default("1280:720"),
});

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.RUNWAYML_API_SECRET;
    if (!apiKey) {
      return NextResponse.json({ error: "Missing RUNWAYML_API_SECRET on server" }, { status: 500 });
    }

    const json = await req.json();
    const { prompt, duration, ratio } = bodySchema.parse(json);

    const client: RunwayClient = new RunwayML({ apiKey });

    // Step 1: Generate a first frame via text-to-image
    const imageTask = await client.textToImage
      .create({
        model: "gen4_image", // or gen4_image_turbo if you prefer
        promptText: prompt,
        ratio: mapRatioForTextImage(ratio),
      })
      .waitForTaskOutput();

    const imageOutput = (imageTask as TaskOutput).output;
    const firstImageUrl = Array.isArray(imageOutput) ? imageOutput[0] : undefined;
    if (!firstImageUrl) {
      return NextResponse.json({ error: "Failed to generate reference image" }, { status: 500 });
    }

    // Step 2: Animate with image-to-video
    const videoTask = await client.imageToVideo
      .create({
        model: "gen4_turbo",
        promptImage: firstImageUrl,
        promptText: prompt,
        ratio: ratio as AllowedVideoRatio,
        duration: duration as 5 | 10,
      })
      .waitForTaskOutput();

    const videoOutput = (videoTask as TaskOutput).output;
    const url = Array.isArray(videoOutput) ? videoOutput[0] : undefined;

    return NextResponse.json({ url });
  } catch (error: unknown) {
    if (error instanceof TaskFailedError) {
      console.error("/api/generate-video task failed", error.taskDetails);
      return NextResponse.json(
        { error: "Generation failed", details: error.taskDetails },
        { status: 502 }
      );
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("/api/generate-video error", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


