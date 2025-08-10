"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Handle, Position, NodeProps, useReactFlow } from "@xyflow/react";
import NextImage from "next/image";
import { imageModels } from "@/lib/models";

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

export function ImageGenerateNode({ id, data }: NodeProps) {
  const rf = useReactFlow();
  const initialPrompt = asString((data as Record<string, unknown> | undefined)?.["prompt"], "A watercolor painting of a fern in a misty forest");
  const initialModel = asString((data as Record<string, unknown> | undefined)?.["model"], imageModels[0]);
  const [prompt, setPrompt] = useState<string>(initialPrompt);
  const [model, setModel] = useState<string>(initialModel);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    rf.setNodes((nds) =>
      nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, prompt } } : n))
    );
  }, [prompt, id, rf]);

  useEffect(() => {
    rf.setNodes((nds) =>
      nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, model } } : n))
    );
  }, [model, id, rf]);

  const run = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, size: "512x512", model }),
      });
      const json = await res.json();
      const url: string | null = json.url || (json.b64 ? `data:image/png;base64,${json.b64}` : null);
      setImageUrl(url);
      if (url) {
        rf.setNodes((nds) =>
          nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, imageUrl: url } } : n))
        );
      }
    } finally {
      setIsLoading(false);
    }
  }, [prompt, model, id, rf]);

  return (
    <div className="bg-background border rounded-md shadow-sm w-[360px]">
      <div className="px-3 py-2 border-b text-sm font-semibold">Image Block</div>
      <div className="p-3 space-y-2">
        <label className="text-xs font-medium">Model</label>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="w-full p-2 text-sm rounded border bg-transparent"
        >
          {imageModels.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <label className="text-xs font-medium">Prompt</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          className="w-full h-20 p-2 text-sm rounded border bg-transparent"
          placeholder="Enter prompt"
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
              <NextImage src={imageUrl} alt="result" width={512} height={512} className="object-cover w-full h-full" unoptimized />
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