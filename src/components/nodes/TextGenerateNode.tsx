"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Handle, Position, NodeProps } from "@xyflow/react";

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

export function TextGenerateNode({ id, data, selected }: NodeProps) {
  const d = (data as Record<string, unknown>) || {};
  const update = (d as any)?._update as ((nodeId: string, partial: Record<string, unknown>) => void) | undefined;
  const openMenu = (d as any)?._openMenu as ((nodeId: string, x: number, y: number) => void) | undefined;
  const selectNode = (d as any)?._select as ((nodeId: string) => void) | undefined;
  const resolveContextText = (d as any)?._resolveContextText as ((nodeId: string) => string) | undefined;
  const resolveContextImages = (d as any)?._resolveContextImages as ((nodeId: string) => string[]) | undefined;
  const initialPrompt = asString(d["prompt"], "Write a haiku about forests.");
  const initialOutput = asString(d["output"], "");
  const initialTextModel = asString(d["textModel"], "Gpt-4o Mini");

  const [prompt, setPrompt] = useState<string>(initialPrompt);
  const [output, setOutput] = useState<string>(initialOutput);
  const [isLoading, setIsLoading] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isToolbarHover, setIsToolbarHover] = useState(false);
  const [isBridgeHover, setIsBridgeHover] = useState(false);
  const [textModel, setTextModel] = useState<string>(initialTextModel);
  const [isModelOpen, setIsModelOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    update?.(id, { prompt: initialPrompt, output: initialOutput, textModel: initialTextModel });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function handleDocMouseDown(e: MouseEvent) {
      if (!dropdownRef.current) return;
      if (!dropdownRef.current.contains(e.target as Node)) {
        setIsModelOpen(false);
      }
    }
    if (isModelOpen) {
      document.addEventListener("mousedown", handleDocMouseDown);
      return () => document.removeEventListener("mousedown", handleDocMouseDown);
    }
  }, [isModelOpen]);

  const run = useCallback(async () => {
    setIsLoading(true);
    try {
      const context = resolveContextText?.(id) ?? "";
      const combined = context ? `${context}\n\n${prompt}` : prompt;
      const images = resolveContextImages?.(id) ?? [];
      const res = await fetch("/api/generate-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: combined, images }),
      });
      const json = await res.json();
      const newOutput = json.text ?? "";
      setOutput(newOutput);
      update?.(id, { output: newOutput });
    } finally {
      setIsLoading(false);
    }
  }, [prompt, id, update, resolveContextText, resolveContextImages]);

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
        // Close any open dropdown when clicking back into block
        setIsModelOpen(false);
      }}
    >
      {/* hover bridge to keep toolbar visible when moving from block to toolbar */}
      {showToolbar && (
        <div
          className="absolute left-0 right-0 -top-16 h-16"
          onMouseEnter={() => setIsBridgeHover(true)}
          onMouseLeave={() => setIsBridgeHover(false)}
          onMouseDown={(e) => e.stopPropagation()}
        />
      )}
      {showToolbar && (
        <div
          className={`absolute -top-16 left-1/2 -translate-x-1/2 z-10`}
          onMouseEnter={() => setIsToolbarHover(true)}
          onMouseLeave={() => setIsToolbarHover(false)}
          onMouseDown={(e) => { setIsToolbarHover(true); e.stopPropagation(); }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className={`relative flex items-center gap-2 rounded-md border bg-background shadow-sm px-3 py-1.5 font-semibold ${
              selected || isToolbarHover || isModelOpen ? "opacity-100" : "opacity-70"
            }`}
          >
            <div className="relative group" ref={dropdownRef}>
              <button
                className="text-sm px-3 py-1.5 rounded hover:bg-foreground/10 inline-flex items-center gap-1"
                onClick={() => { selectNode?.(id); setIsModelOpen((v) => !v); }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <span className="whitespace-nowrap">{textModel}</span>
                <svg className="w-4 h-4 text-foreground/70" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z" clipRule="evenodd" />
                </svg>
              </button>
              {/* tooltip */}
              <div className="pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] text-white opacity-0 group-hover:opacity-100 transition-opacity font-semibold">
                Model
              </div>
              {isModelOpen ? (
                <div
                  className="absolute left-1/2 -translate-x-1/2 top-full mt-1 min-w-[160px] bg-background border rounded-md shadow-lg overflow-hidden text-sm"
                >
                  <button
                    className="w-full text-left px-3 py-2 hover:bg-foreground/10 flex items-center gap-2 font-semibold"
                    onClick={() => {
                      setTextModel("Gpt-4o Mini");
                      update?.(id, { textModel: "Gpt-4o Mini" });
                      setIsModelOpen(false);
                    }}
                  >
                    <span className="inline-block w-4">{textModel === "Gpt-4o Mini" ? "✓" : ""}</span>
                    Gpt-4o Mini
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
      <div className="px-3 py-2 border-b text-sm font-semibold">Text Generate</div>
      <div className="p-3 space-y-2">
        <label className="text-xs font-medium">Prompt</label>
        <textarea
          value={prompt}
          onChange={(e) => {
            const v = e.target.value;
            setPrompt(v);
            update?.(id, { prompt: v });
          }}
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
            value={output}
            onChange={(e) => {
              const v = e.target.value;
              setOutput(v);
              update?.(id, { output: v });
            }}
            className="w-full h-28 p-2 text-sm rounded border bg-transparent nodrag"
            placeholder="Model output (editable)"
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
        </div>
      </div>
      {/* Visible connect "+" handles */}
      <Handle type="target" position={Position.Left} className="!w-9 !h-9 !bg-background !border !border-foreground/30 !shadow absolute" style={{ left: -22, top: "50%", transform: "translate(-50%, -50%)" }} />
      <div className="pointer-events-none absolute text-foreground/80" style={{ left: -22, top: "50%", transform: "translate(-50%, -50%)" }}>+</div>
      <Handle type="source" position={Position.Right} className="!w-9 !h-9 !bg-background !border !border-foreground/30 !shadow absolute" style={{ right: -22, top: "50%", transform: "translate(50%, -50%)" }} />
      <div className="pointer-events-none absolute text-foreground/80" style={{ right: -22, top: "50%", transform: "translate(50%, -50%)" }}>+</div>
    </div>
  );
}