"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Handle, Position, NodeProps, useReactFlow } from "@xyflow/react";
import { textModels } from "@/lib/models";

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

export function TextGenerateNode({ id, data }: NodeProps) {
  const rf = useReactFlow();
  const initialPrompt = asString((data as Record<string, unknown> | undefined)?.["prompt"], "Write a haiku about forests.");
  const initialOutput = asString((data as Record<string, unknown> | undefined)?.["output"], "");
  const initialModel = asString((data as Record<string, unknown> | undefined)?.["model"], textModels[0]);

  const [prompt, setPrompt] = useState<string>(initialPrompt);
  const [output, setOutput] = useState<string>(initialOutput);
  const [model, setModel] = useState<string>(initialModel);
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
      const res = await fetch("/api/generate-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, model }),
      });
      const json = await res.json();
      const out = json.text ?? "";
      setOutput(out);
      rf.setNodes((nds) =>
        nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, output: out } } : n))
      );
    } finally {
      setIsLoading(false);
    }
  }, [prompt, model, id, rf]);

  return (
    <div className="bg-background border rounded-md shadow-sm w-[360px]">
      <div className="px-3 py-2 border-b text-sm font-semibold">Text Block</div>
      <div className="p-3 space-y-2">
        <label className="text-xs font-medium">Model</label>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="w-full p-2 text-sm rounded border bg-transparent"
        >
          {textModels.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <label className="text-xs font-medium">Prompt</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          className="w-full h-24 p-2 text-sm rounded border bg-transparent"
          placeholder="Enter prompt"
        />
        <div className="flex items-center gap-2">
          <button
            onClick={run}
            disabled={isLoading}
            className="px-3 py-1.5 text-sm rounded bg-foreground text-background disabled:opacity-60"
          >
            {isLoading ? "Running..." : "Run"}
          </button>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium">Output</label>
          <textarea
            readOnly
            value={output}
            className="w-full h-28 p-2 text-sm rounded border bg-transparent"
          />
        </div>
      </div>
      <Handle type="source" position={Position.Right} />
      <Handle type="target" position={Position.Left} />
    </div>
  );
}