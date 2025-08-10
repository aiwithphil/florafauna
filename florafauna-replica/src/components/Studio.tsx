"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  MiniMap,
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
import { clsx } from "clsx";

type RFData = Record<string, unknown>;

type StudioNode = Node<RFData>;

type StudioEdge = Edge;

const initialNodes: StudioNode[] = [];
const initialEdges: StudioEdge[] = [];

const nodeTypes = {
  textGenerate: TextGenerateNode,
  imageGenerate: ImageGenerateNode,
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
  const idRef = useRef(1);

  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge(connection, eds)),
    [setEdges]
  );

  const addNode = useCallback(
    (type: keyof typeof nodeTypes) => {
      const id = `${idRef.current++}`;
      const position = { x: 200 + Math.random() * 200, y: 100 + Math.random() * 200 };
      const data: RFData =
        type === "textGenerate"
          ? { prompt: "Write a haiku about forests.", output: "" }
          : { prompt: "A watercolor painting of a fern in a misty forest", imageUrl: "" };
      const newNode: StudioNode = { id, type, position, data };
      setNodes((nds) => nds.concat(newNode));
    },
    [setNodes]
  );

  const proOptions = useMemo(() => ({ hideAttribution: true }), []);

  const runFlow = useCallback(async () => {
    setIsRunning(true);
    try {
      // Simple propagation: for each edge, copy source output -> target prompt
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

      // Execute nodes sequentially in current order (no topological sort yet)
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

  return (
    <div className="w-full h-[calc(100vh-64px)] grid grid-cols-[280px_1fr]">
      <aside className="border-r border-black/10 dark:border-white/10 p-3 space-y-3 bg-background">
        <h2 className="text-sm font-semibold">Nodes</h2>
        <div className="space-y-2">
          <button
            onClick={() => addNode("textGenerate")}
            className={clsx(
              "w-full py-2 px-3 rounded-md border text-sm",
              "bg-foreground text-background border-foreground/20 hover:opacity-90"
            )}
          >
            + Text Generate
          </button>
          <button
            onClick={() => addNode("imageGenerate")}
            className={clsx(
              "w-full py-2 px-3 rounded-md border text-sm",
              "bg-foreground text-background border-foreground/20 hover:opacity-90"
            )}
          >
            + Image Generate
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
        </div>
        <p className="text-xs text-foreground/60">
          Connect nodes to feed text output into downstream prompts. Run the flow to update all nodes.
        </p>
      </aside>
      <div className="w-full h-full">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          proOptions={proOptions}
          fitView
        >
          <Background />
          <MiniMap pannable zoomable />
          <Controls />
          <Panel position="top-left" className="!bg-transparent">
            <div className="rounded-md bg-background/80 backdrop-blur border px-3 py-1 text-xs">
              Studio Canvas
            </div>
          </Panel>
        </ReactFlow>
      </div>
    </div>
  );
}

export default Studio;