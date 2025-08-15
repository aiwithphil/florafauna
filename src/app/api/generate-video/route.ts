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
  model: z.enum([
    "Runway Gen 4 Turbo",
    "Runway Act Two",
    "Runway Aleph",
  ]).optional().default("Runway Gen 4 Turbo"),
  images: z.array(z.string().min(1)).optional().default([]),
  videos: z.array(z.string().min(1)).optional().default([]),
});

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.RUNWAYML_API_SECRET;
    if (!apiKey) {
      return NextResponse.json({ error: "Missing RUNWAYML_API_SECRET on server" }, { status: 500 });
    }

    const json = await req.json();
    const { prompt, duration, ratio, model, images, videos } = bodySchema.parse(json);

    function toFetchableUrl(input: string | undefined): string | undefined {
      if (!input) return undefined;
      // Pass through original URL or data URI untouched; some providers return data URIs which Runway accepts.
      return input;
    }

    const client: RunwayClient = new RunwayML({ apiKey });

    async function uploadAssetFromInput(input: string): Promise<string> {
      try {
        let mime = "application/octet-stream";
        let buf: Buffer | null = null;
        if (input.startsWith("data:")) {
          const match = input.match(/^data:([^;]+);base64,(.*)$/);
          if (!match) throw new Error("Invalid data URL");
          mime = match[1];
          buf = Buffer.from(match[2], "base64");
        } else {
          const res = await fetch(input);
          if (!res.ok) throw new Error(`Failed to fetch asset: ${res.status}`);
          const ab = await res.arrayBuffer();
          buf = Buffer.from(ab);
          mime = res.headers.get("content-type") || mime;
        }

        const anyClient = client as unknown as { assets?: { upload?: (arg: any) => Promise<any>, create?: (arg: any) => Promise<any> } };
        const fileBlob = new Blob([buf!], { type: mime });
        let uploaded: any | undefined;
        if (anyClient.assets?.upload) {
          uploaded = await anyClient.assets.upload({ file: fileBlob });
        } else if (anyClient.assets?.create) {
          uploaded = await anyClient.assets.create({ file: fileBlob });
        }
        const candidate = uploaded?.url || uploaded?.asset?.url || uploaded?.data?.url || uploaded?.asset_url || uploaded?.assetUrl;
        return typeof candidate === "string" && candidate.length > 0 ? candidate : input;
      } catch {
        return input;
      }
    }

    // Route by model
    if (model === "Runway Gen 4 Turbo") {
      // Requires image input; use the first provided image
      let promptImage = toFetchableUrl(images[0]);
      if (!promptImage) {
        return NextResponse.json({ error: "Runway Gen 4 Turbo requires an input image" }, { status: 400 });
      }
      // Ensure the image is a Runway-hosted asset for compatibility
      promptImage = await uploadAssetFromInput(promptImage);
      const videoTask = await client.imageToVideo
        .create({
          model: "gen4_turbo",
          promptImage,
          promptText: prompt,
          publicFigureThreshold: "low",
          ratio: ratio as AllowedVideoRatio,
          duration: duration as 5 | 10,
        })
        .waitForTaskOutput();
      const videoOutput = (videoTask as TaskOutput).output;
      const url = Array.isArray(videoOutput) ? videoOutput[0] : undefined;
      return NextResponse.json({ url });
    }

    if (model === "Runway Act Two") {
      // Requires one image and one video
      let promptImage = toFetchableUrl(images[0]);
      let promptVideo = toFetchableUrl(videos[0]);
      if (!promptImage || !promptVideo) {
        return NextResponse.json({ error: "Runway Act Two requires one image and one video input" }, { status: 400 });
      }
      promptImage = await uploadAssetFromInput(promptImage);
      promptVideo = await uploadAssetFromInput(promptVideo);
      const videoTask = await client.videoToVideo
        .create({
          model: "act_two",
          promptImage,
          promptVideo,
          promptText: prompt,
          publicFigureThreshold: "low",
          ratio: ratio as AllowedVideoRatio,
          duration: duration as 5 | 10,
        })
        .waitForTaskOutput();
      const videoOutput = (videoTask as TaskOutput).output;
      const url = Array.isArray(videoOutput) ? videoOutput[0] : undefined;
      return NextResponse.json({ url });
    }

    if (model === "Runway Aleph") {
      // Requires one video
      let promptVideo = toFetchableUrl(videos[0]);
      if (!promptVideo) {
        return NextResponse.json({ error: "Runway Aleph requires a video input" }, { status: 400 });
      }
      promptVideo = await uploadAssetFromInput(promptVideo);
      const videoTask = await client.videoToVideo
        .create({
          model: "aleph",
          promptVideo,
          promptText: prompt,
          publicFigureThreshold: "low",
          ratio: ratio as AllowedVideoRatio,
          duration: duration as 5 | 10,
        })
        .waitForTaskOutput();
      const videoOutput = (videoTask as TaskOutput).output;
      const url = Array.isArray(videoOutput) ? videoOutput[0] : undefined;
      return NextResponse.json({ url });
    }

    return NextResponse.json({ error: "Unsupported model" }, { status: 400 });

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


