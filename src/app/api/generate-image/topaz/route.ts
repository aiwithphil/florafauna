import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

const bodySchema = z.object({
  // Source image to enhance (URL or data URL)
  image: z.string().min(1),
  // Preferred output dimensions after scaling
  output_width: z.number().int().positive().optional(),
  output_height: z.number().int().positive().optional(),
  // Convenience scale (2|3|4). If provided without explicit dims, the provider may infer from input.
  scale: z.enum(["2", "3", "4"]).or(z.number().int().min(2).max(4)).optional(),
  // Topaz model label (default to Standard V2 from Enhance family)
  model: z
    .enum([
      "Standard V2",
      "Low Resolution V2",
      "CGI",
      "High Fidelity V2",
      "Text Refine",
      // Generative Enhance models (async) kept for forward-compat but we will still submit sync
      "Redefine",
      "Recovery",
      "Recovery V2",
    ])
    .optional()
    .default("Standard V2"),
  // Optional fine-tuning params per Topaz docs – pass through when provided
  sharpen: z.number().min(0).max(1).optional(),
  denoise: z.number().min(0).max(1).optional(),
  fix_compression: z.number().min(0).max(1).optional(),
  strength: z.number().min(0.01).max(1).optional(),
});

async function toBlobFromUrlOrDataUrl(input: string): Promise<Blob> {
  if (input.startsWith("data:")) {
    const match = input.match(/^data:([^;]+);base64,(.*)$/);
    if (!match) throw new Error("Invalid data URL format");
    const mime = match[1];
    const b64 = match[2];
    const buf = Buffer.from(b64, "base64");
    return new Blob([buf], { type: mime });
  }
  const res = await fetch(input);
  if (!res.ok) throw new Error(`Failed to fetch input image: ${res.status}`);
  const ab = await res.arrayBuffer();
  const mime = res.headers.get("content-type") || "application/octet-stream";
  return new Blob([ab], { type: mime });
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.TOPAZ_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Missing TOPAZ_API_KEY on server" }, { status: 500 });
    }

    const json = await req.json();
    const parsed = bodySchema.parse(json);
    let { image, output_width, output_height, scale, model, sharpen, denoise, fix_compression, strength } = parsed;

    // Clamp overly large outputs to a safe max while maintaining aspect ratio
    function clampDims(w: number, h: number, max: number): { w: number; h: number } {
      if (w <= max && h <= max) return { w, h };
      const ratio = w / h;
      if (w >= h) {
        const cw = max;
        const ch = Math.max(1, Math.round(cw / ratio));
        return { w: cw, h: ch };
      } else {
        const ch = max;
        const cw = Math.max(1, Math.round(ch * ratio));
        return { w: cw, h: ch };
      }
    }
    if (typeof output_width === "number" && typeof output_height === "number") {
      const clamped = clampDims(output_width, output_height, 4096);
      output_width = clamped.w;
      output_height = clamped.h;
    }

    // If no explicit height provided, pick a reasonable default from scale (provider can infer width)
    if (typeof output_height !== "number") {
      const sNum = typeof scale === "number" ? scale : Number(scale ?? 2);
      const factor = Number.isFinite(sNum) ? Math.max(2, Math.min(4, sNum)) : 2;
      output_height = Math.min(4096, Math.max(512, Math.round(1024 * factor)));
    }

    const blob = await toBlobFromUrlOrDataUrl(image);
    const ext = blob.type.includes("png") ? "png" : blob.type.includes("jpeg") || blob.type.includes("jpg") ? "jpg" : "bin";

    function createForm(): FormData {
      const f = new FormData();
      f.set("model", model);
      if (typeof output_height === "number") f.set("output_height", String(output_height));
      if (typeof sharpen === "number") f.set("sharpen", String(sharpen));
      if (typeof denoise === "number") f.set("denoise", String(denoise));
      if (typeof fix_compression === "number") f.set("fix_compression", String(fix_compression));
      if (typeof strength === "number") f.set("strength", String(strength));
      f.append("image", blob, `input.${ext}`);
      return f;
    }

    // Try a small set of candidate endpoints to avoid 404s due to path variations
    const candidates = [
      "https://api.topazlabs.com/v1/image/enhance",
      "https://api.topazlabs.com/v1/images/enhance",
      "https://api.topazlabs.com/v1/enhance",
      "https://api.topazlabs.com/image/v1/enhance",
      "https://api.topazlabs.com/images/v1/enhance",
    ];

    // Try multiple auth header variants; vendor docs sometimes differ
    const headerVariants: Array<{ label: string; headers: Record<string, string> }> = [
      { label: "x-api-key", headers: { accept: "application/json", "x-api-key": apiKey } },
      { label: "X-Api-Key", headers: { accept: "application/json", "X-Api-Key": apiKey } },
      { label: "Api-Key", headers: { accept: "application/json", "Api-Key": apiKey } },
      { label: "Authorization Bearer", headers: { accept: "application/json", Authorization: `Bearer ${apiKey}` } },
    ];

    let res: Response | null = null;
    let lastStatus = 0;
    let lastContentType = "";
    let lastBodyText = "";
    let usedEndpoint = "";
    let usedAuth = "";
    outer: for (const url of candidates) {
      for (const hv of headerVariants) {
        const r = await fetch(url, {
          method: "POST",
          headers: hv.headers as any,
          body: createForm(),
        });
        lastStatus = r.status;
        lastContentType = r.headers.get("content-type") || "";
        if (r.status !== 404 && r.status !== 401) {
          res = r;
          usedEndpoint = url;
          usedAuth = hv.label;
          break outer;
        } else {
          // Drain body for better error info
          try { lastBodyText = await r.text(); } catch {}
          usedEndpoint = url;
          usedAuth = hv.label;
        }
      }
    }

    if (!res) {
      return NextResponse.json(
        { error: "Topaz request failed", status: lastStatus || 404, details: lastBodyText || "All candidates failed", endpoint: usedEndpoint, authTried: usedAuth, candidates },
        { status: 502 }
      );
    }

    const contentType = res.headers.get("content-type") || lastContentType || "";
    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json({ error: `Topaz request failed: ${res.status}`, contentType, details: errText || lastBodyText }, { status: 502 });
    }

    if (contentType.includes("application/json")) {
      const data = await res.json();
      const url: string | undefined = data?.output_url || data?.url || data?.image_url;
      const b64: string | undefined = data?.b64 || data?.image_base64;
      if (url || b64) return NextResponse.json({ url, b64 });
      // If JSON but no recognizable fields, fall through to try binary
    }

    // Fallback: treat as image binary and return base64 data URL
    const ab = await res.arrayBuffer();
    const mime = contentType.startsWith("image/") ? contentType : "image/png";
    const b64 = Buffer.from(ab).toString("base64");
    return NextResponse.json({ b64: b64, url: undefined, mime });
  } catch (error: unknown) {
    console.error("/api/generate-image/topaz error", error);
    return NextResponse.json({ error: "Failed to enhance image" }, { status: 500 });
  }
}


