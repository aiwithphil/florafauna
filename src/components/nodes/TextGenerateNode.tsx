"use client";

import React, { useCallback, useState } from "react";
import { Handle, Position, NodeProps } from "@xyflow/react";

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

export function TextGenerateNode({ data }: NodeProps) {
  const initialPrompt = asString((data as Record<string, unknown> | undefined)?.["prompt"], "Write a haiku about forests.");
  const initialOutput = asString((data as Record<string, unknown> | undefined)?.["output"], "");

  const [prompt, setPrompt] = useState<string>(initialPrompt);
  const [output, setOutput] = useState<string>(initialOutput);
  const [isLoading, setIsLoading] = useState(false);

  const run = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/generate-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const json = await res.json();
      setOutput(json.text ?? "");
    } finally {
      setIsLoading(false);
    }
  }, [prompt]);

  return (
    <div className="bg-background border rounded-md shadow-sm w-[360px]">
      <div className="px-3 py-2 border-b text-sm font-semibold">Text Generate</div>
      <div className="p-3 space-y-2">
        <label className="text-xs font-medium">Prompt</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          className="w-full h-24 p-2 text-sm rounded border bg-transparent nodrag"
          placeholder="Enter prompt"
          draggable={false}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerMove={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onMouseMove={(e) => e.stopPropagation()}
          onMouseUp={(e) => e.stopPropagation()}
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