import { NextRequest } from "next/server";

export const runtime = "nodejs";

// Proxies a remote file and forces a download disposition
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const src = searchParams.get("url");
    const filename = searchParams.get("filename") ?? "download";
    if (!src) {
      return new Response(JSON.stringify({ error: "Missing url" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    // Support data URLs directly
    if (src.startsWith("data:")) {
      const match = /^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,(.*)$/i.exec(src);
      if (!match) {
        return new Response(JSON.stringify({ error: "Invalid data URL" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }
      const mime = match[1] || "application/octet-stream";
      const isBase64 = !!match[2];
      const dataPart = match[3] || "";
      const bytes = isBase64 ? Buffer.from(dataPart, "base64") : Buffer.from(decodeURIComponent(dataPart), "utf8");
      const headers = new Headers({
        "content-type": mime,
        "content-disposition": `attachment; filename="${filename}"`,
      });
      return new Response(bytes, { status: 200, headers });
    }

    const upstream = await fetch(src);
    if (!upstream.ok || !upstream.body) {
      return new Response(JSON.stringify({ error: `Upstream fetch failed: ${upstream.status}` }), {
        status: 502,
        headers: { "content-type": "application/json" },
      });
    }

    const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
    const headers = new Headers(upstream.headers);
    headers.set("content-type", contentType);
    headers.set("content-disposition", `attachment; filename="${filename}"`);
    headers.delete("x-robots-tag");
    headers.delete("transfer-encoding");
    headers.delete("content-encoding");

    return new Response(upstream.body, {
      status: 200,
      headers,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Download proxy failed" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}


