import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const apiKey = process.env.MINIMAX_API_KEY;
    const baseUrl = (process.env.MINIMAX_API_BASE_URL || "https://api.minimax.io").replace(/\/$/, "");
    if (!apiKey) return NextResponse.json({ error: "Missing MINIMAX_API_KEY on server" }, { status: 500 });

    const statusPathTmpl = process.env.MINIMAX_STATUS_PATH || "/v1/query/video_generation?task_id={task_id}";
    const statusUrl = `${baseUrl}${statusPathTmpl.replace("{task_id}", encodeURIComponent(id))}`;
    const sResp = await fetch(statusUrl, { method: "GET", headers: { Authorization: `Bearer ${apiKey}` } });
    const sText = await sResp.text();
    if (!sResp.ok) {
      return NextResponse.json({ failed: true, error: `Minimax status failed: ${sResp.status}`, details: sText }, { status: 200 });
    }
    let sData: any; try { sData = JSON.parse(sText); } catch { sData = {}; }
    const state: string | undefined = sData?.status || sData?.data?.status || sData?.task_status;
    if (state && String(state).toLowerCase() === "success") {
      const fileId: string | undefined = sData?.file_id || sData?.data?.file_id;
      if (!fileId) return NextResponse.json({ failed: true, error: "Missing file_id" }, { status: 200 });
      const retrievePath = (process.env.MINIMAX_RETRIEVE_PATH || "/v1/files/retrieve").replace(/\/$/, "");
      const groupId = process.env.MINIMAX_GROUP_ID;

      async function tryRetrieve(u: string, method: "GET" | "POST") {
        const r = await fetch(u, { method, headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" } });
        const t = await r.text();
        if (!r.ok) return null;
        try {
          const j = JSON.parse(t);
          const finalUrl: string | undefined = j?.file?.download_url || j?.download_url || j?.file?.backup_download_url || j?.backup_download_url;
          return typeof finalUrl === "string" ? finalUrl : null;
        } catch {
          return null;
        }
      }

      if (groupId) {
        const u = `${baseUrl}${retrievePath}?GroupId=${encodeURIComponent(groupId)}&file_id=${encodeURIComponent(fileId)}`;
        const got = await tryRetrieve(u, "GET");
        if (got) return NextResponse.json({ done: true, url: got }, { status: 200 });
      }
      {
        const u = `${baseUrl}${retrievePath}?file_id=${encodeURIComponent(fileId)}`;
        const got = await tryRetrieve(u, "GET");
        if (got) return NextResponse.json({ done: true, url: got }, { status: 200 });
      }
      if (groupId) {
        const u = `${baseUrl}${retrievePath}?GroupId=${encodeURIComponent(groupId)}&file_id=${encodeURIComponent(fileId)}`;
        const got = await tryRetrieve(u, "POST");
        if (got) return NextResponse.json({ done: true, url: got }, { status: 200 });
      }

      return NextResponse.json({ state: "success", done: false });
    }

    if (state && ["failed", "fail", "error", "canceled", "cancelled"].includes(String(state).toLowerCase())) {
      return NextResponse.json({ failed: true, state }, { status: 200 });
    }

    return NextResponse.json({ state, done: false }, { status: 200 });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ failed: true, error: message }, { status: 200 });
  }
}


