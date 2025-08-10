"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  Connection,
  Edge,
  Node,
  Panel,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { TextGenerateNode } from "./nodes/TextGenerateNode";
import { ImageGenerateNode } from "./nodes/ImageGenerateNode";
import { VideoGenerateNode } from "./nodes/VideoGenerateNode";
import { clsx } from "clsx";

type RFData = Record<string, unknown>;

type StudioNode = Node<RFData>;

type StudioEdge = Edge;

const initialNodes: StudioNode[] = [];
const initialEdges: StudioEdge[] = [];

const nodeTypes = {
  textGenerate: TextGenerateNode,
  imageGenerate: ImageGenerateNode,
  videoGenerate: VideoGenerateNode,
};

function getDataString(node: StudioNode, key: string): string | undefined {
  const value = node.data?.[key];
  return typeof value === "string" ? value : undefined;
}

function withDataString(node: StudioNode, key: string, value: string): StudioNode {
  return { ...node, data: { ...(node.data ?? {}), [key]: value } };
}

async function runText(prompt: string): Promise<string> {
  const res = await fetch("/api/generate-text", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  const json = await res.json();
  return json.text ?? "";
}

async function runImage(prompt: string): Promise<string | null> {
  const res = await fetch("/api/generate-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, size: "512x512" }),
  });
  const json = await res.json();
  return json.url || (json.b64 ? `data:image/png;base64,${json.b64}` : null);
}

export function Studio() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [isRunning, setIsRunning] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [palettePos, setPalettePos] = useState<{ x: number; y: number } | null>(null);
  const idRef = useRef(1);

  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge(connection, eds)),
    [setEdges]
  );

  const addNode = useCallback(
    (type: keyof typeof nodeTypes, position?: { x: number; y: number }) => {
      const id = `${idRef.current++}`;
      const pos = position ?? { x: 200 + Math.random() * 200, y: 100 + Math.random() * 200 };
      const data: RFData =
        type === "textGenerate"
          ? { prompt: "Write a haiku about forests.", output: "", model: "gpt-4o-mini" }
          : type === "imageGenerate"
          ? { prompt: "A watercolor painting of a fern in a misty forest", imageUrl: "", model: "gpt-image-1" }
          : { prompt: "A sweeping aerial shot over a rainforest canopy at dawn", model: "gpt-video-1" };
      const newNode: StudioNode = { id, type, position: pos, data };
      setNodes((nds) => nds.concat(newNode));
    },
    [setNodes]
  );

  const proOptions = useMemo(() => ({ hideAttribution: true }), []);

  const runFlow = useCallback(async () => {
    setIsRunning(true);
    try {
      setNodes((nds) => {
        const idToNode = new Map(nds.map((n) => [n.id, n] as const));
        edges.forEach((e) => {
          const src = idToNode.get(e.source);
          const tgt = idToNode.get(e.target);
          if (!src || !tgt) return;
          const sourceOut = getDataString(src as StudioNode, "output");
          if (sourceOut && sourceOut.length > 0) {
            const updatedTarget = withDataString(tgt as StudioNode, "prompt", sourceOut);
            idToNode.set(tgt.id, updatedTarget);
          }
        });
        return nds.map((n) => idToNode.get(n.id) ?? n);
      });

      for (const n of nodes as StudioNode[]) {
        if (n.type === "textGenerate") {
          const prompt = getDataString(n, "prompt");
          if (prompt && prompt.length > 0) {
            const out = await runText(prompt);
            setNodes((nds) => nds.map((x) => (x.id === n.id ? withDataString(x as StudioNode, "output", out) : x)));
          }
        } else if (n.type === "imageGenerate") {
          const prompt = getDataString(n, "prompt");
          if (prompt && prompt.length > 0) {
            const url = await runImage(prompt);
            if (url) {
              setNodes((nds) => nds.map((x) => (x.id === n.id ? withDataString(x as StudioNode, "imageUrl", url) : x)));
            }
          }
        }
      }
    } finally {
      setIsRunning(false);
    }
  }, [edges, nodes, setNodes]);

  const openPalette = useCallback((pos?: { x: number; y: number }) => {
    setPalettePos(pos ?? null);
    setPaletteOpen(true);
  }, []);

  const closePalette = useCallback(() => setPaletteOpen(false), []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === " " || e.code === "Space") {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName?.toLowerCase();
        const isTyping = tag === "input" || tag === "textarea" || target?.isContentEditable;
        if (!isTyping) {
          e.preventDefault();
          openPalette();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openPalette]);

  return (
    <div className="w-full h-[calc(100vh-64px)] grid grid-cols-[280px_1fr]">
      <aside className="border-r border-black/10 dark:border-white/10 p-3 space-y-3 bg-background">
        <h2 className="text-sm font-semibold">Blocks</h2>
        <div className="space-y-2">
          <button
            onClick={() => addNode("textGenerate")}
            className={clsx(
              "w-full py-2 px-3 rounded-md border text-sm",
              "bg-foreground text-background border-foreground/20 hover:opacity-90"
            )}
          >
            + Add Text Block
          </button>
          <button
            onClick={() => addNode("imageGenerate")}
            className={clsx(
              "w-full py-2 px-3 rounded-md border text-sm",
              "bg-foreground text-background border-foreground/20 hover:opacity-90"
            )}
          >
            + Add Image Block
          </button>
          <button
            onClick={() => addNode("videoGenerate")}
            className={clsx(
              "w-full py-2 px-3 rounded-md border text-sm",
              "bg-foreground text-background border-foreground/20 hover:opacity-90"
            )}
          >
            + Add Video Block
          </button>
          <button
            onClick={runFlow}
            disabled={isRunning}
            className={clsx(
              "w-full py-2 px-3 rounded-md border text-sm",
              "border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-60"
            )}
          >
            {isRunning ? "Running Flow..." : "Run Flow"}
          </button>
          <div className="text-[11px] text-foreground/60">Tip: Double-click the canvas or press Space to add a block.</div>
        </div>
        <p className="text-xs text-foreground/60">
          Connect blocks to feed text output into downstream prompts. Run the flow to update all blocks.
        </p>
      </aside>
      <div className="relative w-full h-full">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          proOptions={proOptions}
          fitView
          onPaneClick={(e) => {
            const me = e as unknown as MouseEvent;
            const isDouble = (me as MouseEvent).detail === 2;
            if (isDouble) {
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              openPalette({ x: me.clientX - rect.left, y: me.clientY - rect.top });
            }
          }}
        >
          <Background />
          <Panel position="top-left" className="!bg-transparent">
            <div className="rounded-md bg-background/80 backdrop-blur border px-3 py-1 text-xs">
              Studio Canvas
            </div>
          </Panel>
        </ReactFlow>

        {paletteOpen && (
          <div className="absolute inset-0 z-50" onClick={closePalette}>
            <div
              className="absolute w-56 rounded-md border bg-background shadow-lg p-2 space-y-1"
              style={{
                left: (palettePos?.x ?? 240) - 112,
                top: (palettePos?.y ?? 120) - 10,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-xs text-foreground/60 px-2">Add block</div>
              <button
                className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-black/5 dark:hover:bg-white/5"
                onClick={() => {
                  addNode("textGenerate", { x: (palettePos?.x ?? 240), y: (palettePos?.y ?? 120) });
                  closePalette();
                }}
              >
                Text
              </button>
              <button
                className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-black/5 dark:hover:bg-white/5"
                onClick={() => {
                  addNode("imageGenerate", { x: (palettePos?.x ?? 240), y: (palettePos?.y ?? 120) });
                  closePalette();
                }}
              >
                Image
              </button>
              <button
                className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-black/5 dark:hover:bg-white/5"
                onClick={() => {
                  addNode("videoGenerate", { x: (palettePos?.x ?? 240), y: (palettePos?.y ?? 120) });
                  closePalette();
                }}
              >
                Video
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default Studio;