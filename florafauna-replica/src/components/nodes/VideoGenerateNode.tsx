"use client";

import React, { useEffect, useState } from "react";
import { Handle, Position, NodeProps, useReactFlow } from "@xyflow/react";
import { videoModels } from "@/lib/models";

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

export function VideoGenerateNode({ id, data }: NodeProps) {
  const rf = useReactFlow();
  const initialPrompt = asString((data as Record<string, unknown> | undefined)?.["prompt"], "A sweeping aerial shot over a rainforest canopy at dawn");
  const initialModel = asString((data as Record<string, unknown> | undefined)?.["model"], videoModels[0]);

  const [prompt, setPrompt] = useState<string>(initialPrompt);
  const [model, setModel] = useState<string>(initialModel);

  useEffect(() => {
    rf.setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, prompt } } : n)));
  }, [prompt, id, rf]);

  useEffect(() => {
    rf.setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, model } } : n)));
  }, [model, id, rf]);

  return (
    <div className="bg-background border rounded-md shadow-sm w-[360px]">
      <div className="px-3 py-2 border-b text-sm font-semibold">Video Block</div>
      <div className="p-3 space-y-2">
        <label className="text-xs font-medium">Model</label>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="w-full p-2 text-sm rounded border bg-transparent"
        >
          {videoModels.map((m) => (
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
        <div className="text-xs text-foreground/60">Generation coming soon</div>
      </div>
      <Handle type="source" position={Position.Right} />
      <Handle type="target" position={Position.Left} />
    </div>
  );
}