"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Handle, Position, NodeProps } from "@xyflow/react";

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

export function VideoGenerateNode({ id, data, selected }: NodeProps) {
  const d = (data as Record<string, unknown>) || {};
  const update = (d as any)?._update as ((nodeId: string, partial: Record<string, unknown>) => void) | undefined;
  const openMenu = (d as any)?._openMenu as ((nodeId: string, x: number, y: number) => void) | undefined;
  const selectNode = (d as any)?._select as ((nodeId: string) => void) | undefined;
  const resolveContextText = (d as any)?._resolveContextText as ((nodeId: string) => string) | undefined;
  const resolveContextImages = (d as any)?._resolveContextImages as ((nodeId: string) => string[]) | undefined;
  const resolveContextVideos = (d as any)?._resolveContextVideos as ((nodeId: string) => string[]) | undefined;
  const initialPrompt = asString(d["prompt"], "A short looping animation of leaves swaying in the wind");
  const initialVidRatio = asString(d["vidRatio"], "auto");
  const initialVidModel = asString(d["vidModel"], "Kling 1.6");
  const [prompt, setPrompt] = useState<string>(initialPrompt);
  const [videoUrl, setVideoUrl] = useState<string | null>((typeof d["videoUrl"] === "string" ? (d["videoUrl"] as string) : null));
  const promptLocked = Boolean((d as any)?.promptLocked);
  const [isLoading, setIsLoading] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [isToolbarHover, setIsToolbarHover] = useState(false);
  const [isBridgeHover, setIsBridgeHover] = useState(false);
  const [vidRatio, setVidRatio] = useState(initialVidRatio);
  const [vidModel, setVidModel] = useState(initialVidModel);
  const [openWhich, setOpenWhich] = useState<null | "ratio" | "model" | "duration">(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const [warning, setWarning] = useState<string>("");
  const initialDuration = Number.isFinite(Number((d as any)?.vidDuration)) ? Number((d as any)?.vidDuration) : 5;
  const [durationSec, setDurationSec] = useState<5 | 10>((initialDuration === 10 ? 10 : 5));
  function sanitizeEnhancedPrompt(text: string): string {
    let s = (text ?? "").trim();
    s = s.replace(/^\s*(\*\*)?\s*Enhanced Prompt:?\s*(\*\*)?\s*\n*/i, "");
    s = s.replace(/\*\*/g, "");
    s = s
      .split("\n")
      .map((line) => line.replace(/^\s*(?:[-*•]\s*)?(?:\[\s*[xX]?\s*\]\s*)?/, ""))
      .join("\n");
    return s.trim();
  }
  const ratioLabel = (value: string) => (value === "auto" ? "Auto" : value);

  function parseAspect(value: string): [number, number] | null {
    if (!value.includes(":")) return null;
    const [wStr, hStr] = value.split(":");
    const w = Number(wStr);
    const h = Number(hStr);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
    return [w, h];
  }

  function AspectIcon({ value }: { value: string }) {
    if (value === "auto") {
      return (
        <svg className="w-5 h-4" viewBox="0 0 24 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
          <rect x="1" y="1" width="22" height="14" rx="2" stroke="currentColor" strokeDasharray="2 2" />
          <text x="12" y="11" textAnchor="middle" fontSize="8" fill="currentColor">A</text>
        </svg>
      );
    }
    const parsed = parseAspect(value);
    const boxW = 24;
    const boxH = 16;
    const pad = 2;
    if (!parsed) {
      return (
        <svg className="w-5 h-4" viewBox="0 0 24 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
          <rect x="1" y="1" width="22" height="14" rx="2" stroke="currentColor" />
        </svg>
      );
    }
    const [w, h] = parsed;
    const maxDim = Math.max(w, h);
    const innerAvailW = boxW - pad * 2;
    const innerAvailH = boxH - pad * 2;
    const innerW = Math.max(4, Math.round((w / maxDim) * innerAvailW));
    const innerH = Math.max(4, Math.round((h / maxDim) * innerAvailH));
    const innerX = Math.round((boxW - innerW) / 2);
    const innerY = Math.round((boxH - innerH) / 2);
    return (
      <svg className="w-5 h-4" viewBox="0 0 24 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
        <rect x="1" y="1" width="22" height="14" rx="2" stroke="currentColor" />
        <rect x={innerX} y={innerY} width={innerW} height={innerH} rx="1" fill="currentColor" />
      </svg>
    );
  }

  const isGen4Turbo = vidModel === "Runway Gen 4 Turbo";
  type SizeOption = { label: string; value: string };
  type SizeGroup = { heading: string; options: SizeOption[] };
  const sizeGroups: SizeGroup[] = React.useMemo(() => {
    if (isGen4Turbo) {
      return [
        { heading: "Auto", options: [{ label: "Auto", value: "auto" }] },
        { heading: "Square", options: [{ label: "1:1", value: "1:1" }] },
        { heading: "Horizontal", options: [
          { label: "21:9", value: "21:9" },
          { label: "16:9", value: "16:9" },
          { label: "4:3", value: "4:3" },
        ] },
        { heading: "Vertical", options: [
          { label: "3:4", value: "3:4" },
          { label: "9:16", value: "9:16" },
        ] },
      ];
    }
    // Fallback to legacy simple list
    return [
      { heading: "Sizes", options: [
        { label: "1:1 (Square)", value: "1:1" },
        { label: "16:9 (Horizontal)", value: "16:9" },
        { label: "9:16 (Vertical)", value: "9:16" },
      ]},
    ];
  }, [isGen4Turbo]);

  function mapFriendlyRatioToApi(value: string): string {
    switch (value) {
      case "auto":
        return "auto"; // will be resolved from upstream image aspect in run()
      case "1:1":
        return "960:960";
      case "21:9":
        return "1584:672";
      case "16:9":
        return "1280:720";
      case "4:3":
        return "1104:832";
      case "3:4":
        return "832:1104";
      case "9:16":
        return "720:1280";
      default:
        return "1280:720";
    }
  }

  async function getImageNaturalSize(src: string): Promise<{ width: number; height: number } | null> {
    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      return await new Promise((resolve) => {
        const img = new Image();
        let url = src;
        try {
          const isData = src.startsWith("data:");
          const isHttp = src.startsWith("http://") || src.startsWith("https://");
          if (!isData && isHttp) {
            url = `/api/download?url=${encodeURIComponent(src)}&filename=probe.jpg`;
          }
        } catch {}
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => resolve(null);
        img.src = url;
      });
    } catch {
      return null;
    }
  }

  async function pickApiRatioForAutoFromImage(src: string): Promise<string> {
    const dims = await getImageNaturalSize(src);
    if (!dims) return "1280:720";
    const r = dims.width / Math.max(1, dims.height);
    // Candidate API ratios with numeric values
    const candidates: Array<{ ratio: string; value: number }> = [
      { ratio: "960:960", value: 1.0 }, // 1:1
      { ratio: "1104:832", value: 1104 / 832 }, // 4:3 ≈ 1.327
      { ratio: "1280:720", value: 1280 / 720 }, // 16:9 ≈ 1.777
      { ratio: "1584:672", value: 1584 / 672 }, // 21:9 ≈ 2.357
      { ratio: "832:1104", value: 832 / 1104 }, // 3:4 ≈ 0.753
      { ratio: "720:1280", value: 720 / 1280 }, // 9:16 = 0.5625
    ];
    let best = candidates[0];
    let bestDelta = Math.abs(r - candidates[0].value);
    for (let i = 1; i < candidates.length; i++) {
      const d = Math.abs(r - candidates[i].value);
      if (d < bestDelta) {
        best = candidates[i];
        bestDelta = d;
      }
    }
    return best.ratio;
  }

  // Sync local prompt when controlled by linked text output
  useEffect(() => {
    const dataPrompt = asString(d["prompt"], prompt);
    if (promptLocked && dataPrompt !== prompt) {
      setPrompt(dataPrompt);
    }
  }, [promptLocked, d, prompt]);

  useEffect(() => {
    update?.(id, { prompt: initialPrompt, videoUrl: videoUrl ?? "", vidRatio: initialVidRatio, vidModel: initialVidModel });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onDocDown(e: MouseEvent) {
      if (!toolbarRef.current) return;
      if (!toolbarRef.current.contains(e.target as Node)) setOpenWhich(null);
    }
    if (openWhich) {
      document.addEventListener("mousedown", onDocDown);
      return () => document.removeEventListener("mousedown", onDocDown);
    }
  }, [openWhich]);

  useEffect(() => {
    if (!selected) {
      setIsToolbarHover(false);
      setIsBridgeHover(false);
      setOpenWhich(null);
    }
  }, [selected]);

  const run = useCallback(async () => {
    setIsLoading(true);
    try {
      const context = resolveContextText?.(id) ?? "";
      const effectivePrompt = promptLocked ? prompt : (context ? `${context}\n\n${prompt}` : prompt);
      const upstreamImages = resolveContextImages?.(id) ?? [];
      const upstreamVideos = resolveContextVideos?.(id) ?? [];

      // Enforce model-specific attachment requirements
      const isGen4Turbo = vidModel === "Runway Gen 4 Turbo";
      const isActTwo = vidModel === "Runway Act Two";
      const isAleph = vidModel === "Runway Aleph";

      if (isGen4Turbo && upstreamImages.length < 1) {
        setWarning("This model is image-to-video only. Please attach an image block.");
        setIsLoading(false);
        return;
      }
      if (isActTwo && (upstreamImages.length < 1 || upstreamVideos.length < 1)) {
        setWarning("This model requires one image and one video block. Please attach the missing block(s).");
        setIsLoading(false);
        return;
      }
      if (isAleph && upstreamVideos.length < 1) {
        setWarning("This model requires a video block. Please attach a video block.");
        setIsLoading(false);
        return;
      }

      setWarning("");

      // Resolve API ratio, supporting Auto for Gen-4 Turbo based on upstream image aspect
      let apiRatio = mapFriendlyRatioToApi(vidRatio);
      if (apiRatio === "auto" && isGen4Turbo) {
        const imageForAuto = upstreamImages[0];
        apiRatio = imageForAuto ? await pickApiRatioForAutoFromImage(imageForAuto) : "1280:720";
      }

      const res = await fetch("/api/generate-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: effectivePrompt,
          duration: durationSec,
          ratio: apiRatio,
          model: vidModel,
          images: upstreamImages.slice(0, 1),
          videos: upstreamVideos.slice(0, 1),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error ?? "Failed to generate video");
        return;
      }
      setError(null);
      if (json.url) {
        setVideoUrl(json.url);
        update?.(id, { videoUrl: json.url });
      }
    } finally {
      setIsLoading(false);
    }
  }, [prompt, id, update, promptLocked, resolveContextText]);

  const showToolbar = isHovered || !!selected || isToolbarHover || isBridgeHover;

  return (
    <div
      className="relative bg-background border rounded-md shadow-sm w-[360px]"
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        openMenu?.(id, e.clientX, e.clientY);
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onMouseDown={() => {
        setOpenWhich(null);
      }}
    >
      {showToolbar && (
        <div
          className="absolute left-0 right-0 -top-16 h-16"
          onMouseEnter={() => setIsBridgeHover(true)}
          onMouseLeave={() => setIsBridgeHover(false)}
          onMouseDown={(e) => e.stopPropagation()}
        />
      )}
      {showToolbar && (
        <div className="absolute -top-16 left-1/2 -translate-x-1/2 z-10" onMouseEnter={() => setIsToolbarHover(true)} onMouseLeave={() => setIsToolbarHover(false)} onMouseDown={(e) => { setIsToolbarHover(true); e.stopPropagation(); }} onClick={(e) => e.stopPropagation()}>
          <div ref={toolbarRef} className={`relative flex items-center gap-2 rounded-md border bg-background shadow-sm px-3 py-1.5 font-semibold ${selected || isToolbarHover || openWhich ? "opacity-100" : "opacity-70"}`}>
            {/* Duration */}
            <div className="relative group">
              <button className="text-sm px-3 py-1.5 rounded hover:bg-foreground/10 inline-flex items-center gap-1" onClick={() => { selectNode?.(id); setOpenWhich((w) => (w === "duration" ? null : "duration")); }}>
                <span>{durationSec === 5 ? "5S" : "10S"}</span>
                <svg className="w-4 h-4 text-foreground/70" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z" clipRule="evenodd" />
                </svg>
              </button>
              <div className="pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] text-foreground opacity-0 group-hover:opacity-100 transition-opacity font-semibold">Duration</div>
              {openWhich === "duration" ? (
                <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1 min-w-[160px] bg-background border rounded-md shadow-lg overflow-hidden text-sm">
                  {([
                    { label: "5 Seconds", value: 5 },
                    { label: "10 Seconds", value: 10 },
                  ] as const).map((opt) => (
                    <button
                      key={opt.value}
                      className="w-full text-left px-3 py-2 hover:bg-foreground/10 flex items-center gap-2"
                      onClick={() => {
                        setDurationSec(opt.value);
                        update?.(id, { vidDuration: opt.value });
                        setOpenWhich(null);
                      }}
                    >
                      <span className="flex-1">{opt.label}</span>
                      <span className="inline-flex w-4 justify-end">{durationSec === opt.value ? "✓" : ""}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            {/* Ratio */}
            <div className="relative group">
              <button className="text-sm px-3 py-1.5 rounded hover:bg-foreground/10 inline-flex items-center gap-1" onClick={() => { selectNode?.(id); setOpenWhich((w) => (w === "ratio" ? null : "ratio")); }}>
                <span>{vidRatio === "auto" ? "Auto" : vidRatio}</span>
                <svg className="w-4 h-4 text-foreground/70" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z" clipRule="evenodd" />
                </svg>
              </button>
              <div className="pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] text-foreground opacity-0 group-hover:opacity-100 transition-opacity font-semibold">Size</div>
              {openWhich === "ratio" ? (
                <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1 min-w-[220px] bg-background border rounded-md shadow-lg overflow-hidden text-sm">
                  {sizeGroups.map((group, gi) => (
                    <div key={gi} className={gi > 0 ? "border-t border-foreground/10" : undefined}>
                      <div className="px-3 pt-2 pb-1 text-xs text-foreground/50">{group.heading}</div>
                      {group.options.map((opt) => (
                        <button
                          key={opt.value}
                          className="w-full text-left px-3 py-2 hover:bg-foreground/10 flex items-center gap-2"
                          onClick={() => {
                            setVidRatio(opt.value);
                            update?.(id, { vidRatio: opt.value });
                            setOpenWhich(null);
                          }}
                        >
                          <span className="inline-flex w-6 justify-center"><AspectIcon value={opt.value} /></span>
                          <span className="flex-1">{ratioLabel(opt.value)}</span>
                          <span className="inline-flex w-4 justify-end">{vidRatio === opt.value ? "✓" : ""}</span>
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
            {/* Model */}
            <div className="relative group">
              <button className="text-sm px-3 py-1.5 rounded hover:bg-foreground/10 inline-flex items-center gap-1" onClick={() => { selectNode?.(id); setOpenWhich((w) => (w === "model" ? null : "model")); }}>
                <span className="whitespace-nowrap">{vidModel}</span>
                <svg className="w-4 h-4 text-foreground/70" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z" clipRule="evenodd" />
                </svg>
              </button>
              <div className="pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] text-foreground opacity-0 group-hover:opacity-100 transition-opacity font-semibold">Model</div>
              {openWhich === "model" ? (
                <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1 min-w-[300px] bg-background border rounded-md shadow-lg overflow-hidden text-sm">
                  {[
                    "Kling 2.1 Master",
                    "Kling 2.0 Master",
                    "Kling 1.6",
                    "Veo 2",
                    "Veo 3",
                    "Minimax Hailuo",
                    "Minimax Hailuo 02 Pro",
                    "Pika",
                    "Runway Gen 4 Turbo",
                    "Runway Act Two",
                    "Runway Aleph",
                  ].map((label) => (
                    <button
                      key={label}
                      className="w-full text-left px-3 py-2 hover:bg-foreground/10 flex items-center justify-between gap-2"
                      onClick={() => {
                        setVidModel(label);
                        update?.(id, { vidModel: label });
                        setOpenWhich(null);
                      }}
                    >
                      <span className="flex items-center gap-2">
                        <span className="inline-block w-4">{vidModel === label ? "✓" : ""}</span>
                        {label}
                      </span>
                      <span className="text-xs">1000 credits</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            {/* Enhance prompt */}
            <div className="relative group">
              <button
                className="text-xs px-2 py-1 rounded hover:bg-foreground/10 disabled:opacity-60"
                title="Enhance prompt"
                disabled={isEnhancing}
                onClick={async () => {
                  try {
                    setIsEnhancing(true);
                    const instruction =
                      "You are an AI prompt enhancer for text-to-video generation. Take the user’s raw prompt and rewrite it into a cinematic, highly descriptive sequence that preserves the original concept but maximizes realism, coherence, and visual storytelling. Include camera movement, scene transitions, shot types, lighting, pacing, and environmental details. Use vivid language to describe motion, atmosphere, and mood. Keep it suitable for continuous video flow, avoiding static or unrelated scenes. Output only the final enhanced prompt and nothing else.";
                    const composed = `${instruction}\n\nRaw prompt:\n"""\n${prompt}\n"""`;
                    const res = await fetch("/api/generate-text", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ prompt: composed }),
                    });
                    const json = await res.json();
                    const enhancedPrompt = sanitizeEnhancedPrompt(json?.text ?? "");
                    if (enhancedPrompt) {
                      setPrompt(enhancedPrompt);
                      update?.(id, { prompt: enhancedPrompt });
                    }
                  } finally {
                    setIsEnhancing(false);
                  }
                }}
              >
                {isEnhancing ? "…" : "✨"}
              </button>
              <div className="pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] text-foreground opacity-0 group-hover:opacity-100 transition-opacity font-semibold">Enhance Prompt</div>
            </div>
          </div>
        </div>
      )}
      <div className="px-3 py-2 border-b text-sm font-semibold">Video Generate</div>
      <div className="p-3 space-y-2">
        <label className="text-xs font-medium">Prompt {promptLocked ? <span className="text-[10px] ml-1 text-foreground/60">(from linked text)</span> : null}</label>
        <textarea
          value={prompt}
          onChange={(e) => {
            if (promptLocked) return;
            const v = e.target.value;
            setPrompt(v);
            update?.(id, { prompt: v });
          }}
          className="w-full h-20 p-2 text-sm rounded border bg-transparent nodrag"
          placeholder="Enter prompt"
          readOnly={promptLocked}
          draggable={false}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerMove={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onMouseMove={(e) => e.stopPropagation()}
          onMouseUp={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onDragStart={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
          onTouchEnd={(e) => e.stopPropagation()}
        />
        <div className="flex items-center gap-2">
          <button
            onClick={run}
            disabled={isLoading}
            className="px-3 py-1.5 text-sm rounded bg-foreground text-background disabled:opacity-60"
          >
            {isLoading ? "Generating..." : "Generate"}
          </button>
        </div>
        {warning ? (
          <div className="text-xs text-red-500">{warning}</div>
        ) : null}
        <div className="space-y-1">
          <label className="text-xs font-medium">Result</label>
          <div className="w-full h-[256px] bg-black/5 rounded grid place-items-center overflow-hidden">
            {videoUrl ? (
              <video src={videoUrl} controls className="object-cover w-full h-full" />
            ) : (
              <span className="text-xs text-foreground/60">
                {isLoading ? "Generating video..." : error ?? "No video yet"}
              </span>
            )}
          </div>
        </div>
      </div>
      {/* Visible plus handles */}
      <Handle type="target" position={Position.Left} className="!w-9 !h-9 !bg-background !border !border-foreground/30 !shadow absolute" style={{ left: -22, top: "50%", transform: "translate(-50%, -50%)" }} />
      <div className="pointer-events-none absolute text-foreground/80" style={{ left: -22, top: "50%", transform: "translate(-50%, -50%)" }}>+</div>
      <Handle type="source" position={Position.Right} className="!w-9 !h-9 !bg-background !border !border-foreground/30 !shadow absolute" style={{ right: -22, top: "50%", transform: "translate(50%, -50%)" }} />
      <div className="pointer-events-none absolute text-foreground/80" style={{ right: -22, top: "50%", transform: "translate(50%, -50%)" }}>+</div>
    </div>
  );
}

export default VideoGenerateNode;


