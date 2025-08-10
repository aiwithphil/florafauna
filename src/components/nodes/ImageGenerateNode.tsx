"use client";

import React, { useCallback, useState } from "react";
import { Handle, Position, NodeProps } from "@xyflow/react";

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

export function ImageGenerateNode({ data }: NodeProps) {
  const initialPrompt = asString((data as Record<string, unknown> | undefined)?.["prompt"], "A watercolor painting of a fern in a misty forest");
  const [prompt, setPrompt] = useState<string>(initialPrompt);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const run = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, size: "1024x1024" }),
      });
      const json = await res.json();
      if (json.url) {
        setImageUrl(json.url);
      } else if (json.b64) {
        setImageUrl(`data:image/png;base64,${json.b64}`);
      }
    } finally {
      setIsLoading(false);
    }
  }, [prompt]);

  return (
    <div className="bg-background border rounded-md shadow-sm w-[360px]">
      <div className="px-3 py-2 border-b text-sm font-semibold">Image Generate</div>
      <div className="p-3 space-y-2">
        <label className="text-xs font-medium">Prompt</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          className="w-full h-20 p-2 text-sm rounded border bg-transparent nodrag nowheel"
          placeholder="Enter prompt"
          draggable={false}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerMove={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onMouseMove={(e) => e.stopPropagation()}
          onMouseUp={(e) => e.stopPropagation()}
          onDragStart={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
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
        <div className="space-y-1">
          <label className="text-xs font-medium">Result</label>
          <div className="w-full h-[256px] bg-black/5 rounded grid place-items-center overflow-hidden">
            {imageUrl ? (
              <img src={imageUrl} alt="result" className="object-cover w-full h-full" />
            ) : (
              <span className="text-xs text-foreground/60">
                {isLoading ? "Generating image..." : "No image yet"}
              </span>
            )}
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Right} />
      <Handle type="target" position={Position.Left} />
    </div>
  );
}