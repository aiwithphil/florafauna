import { NextRequest } from "next/server";

export const runtime = "edge";

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


