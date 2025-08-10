"use client";

import React, { useCallback, useMemo, useRef } from "react";
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

const initialNodes: Node[] = [];
const initialEdges: Edge[] = [];

const nodeTypes = {
  textGenerate: TextGenerateNode,
  imageGenerate: ImageGenerateNode,
};

export function Studio() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const idRef = useRef(1);

  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge(connection, eds)),
    [setEdges]
  );

  const addNode = useCallback(
    (type: keyof typeof nodeTypes) => {
      const id = `${idRef.current++}`;
      const position = { x: 200 + Math.random() * 200, y: 100 + Math.random() * 200 };
      const data = {};
      const newNode: Node = { id, type, position, data };
      setNodes((nds) => nds.concat(newNode));
    },
    [setNodes]
  );

  const proOptions = useMemo(() => ({ hideAttribution: true }), []);

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
        </div>
        <p className="text-xs text-foreground/60">
          Connect nodes to design flows. Select a node to edit parameters.
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