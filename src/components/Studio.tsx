"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  Background,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  Connection,
  Edge,
  Node,
  SelectionMode,
} from "@xyflow/react";
import type { ReactFlowInstance } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { TextGenerateNode } from "./nodes/TextGenerateNode";
import { ImageGenerateNode } from "./nodes/ImageGenerateNode";
import { VideoGenerateNode } from "@/components/nodes/VideoGenerateNode";
import { clsx } from "clsx";

const initialNodes: Node[] = [];
const initialEdges: Edge[] = [];

const nodeTypes = {
  textGenerate: TextGenerateNode,
  imageGenerate: ImageGenerateNode,
  videoGenerate: VideoGenerateNode,
};

export function Studio() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const idRef = useRef(1);
  const instanceRef = useRef<ReactFlowInstance | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [menuScreenPos, setMenuScreenPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [menuStage, setMenuStage] = useState<"primary" | "type">("type");
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);

  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge(connection, eds)),
    [setEdges]
  );

  const addNode = useCallback(
    (type: keyof typeof nodeTypes, position?: { x: number; y: number }) => {
      const id = `${idRef.current++}`;
      const nodePosition = position ?? { x: 200 + Math.random() * 200, y: 100 + Math.random() * 200 };
      const data = {};
      const newNode: Node = { id, type, position: nodePosition, data } as Node;
      setNodes((nds) => nds.concat(newNode));
    },
    [setNodes]
  );

  const openNewBlockMenuAt = useCallback((clientX: number, clientY: number, stage: "primary" | "type" = "type") => {
    setMenuScreenPos({ x: clientX, y: clientY });
    setMenuStage(stage);
    setIsMenuOpen(true);
  }, []);

  const handleDoubleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    openNewBlockMenuAt(e.clientX, e.clientY, "type");
  }, [openNewBlockMenuAt]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.code === "Space") {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      e.preventDefault();
      const last = lastPointerRef.current;
      if (last) {
        openNewBlockMenuAt(last.x, last.y, "type");
      } else {
        const bounds = wrapperRef.current?.getBoundingClientRect();
        const centerX = (bounds?.left ?? 0) + (bounds?.width ?? 0) / 2;
        const centerY = (bounds?.top ?? 0) + (bounds?.height ?? 0) / 2;
        openNewBlockMenuAt(centerX, centerY, "type");
      }
    }
  }, [openNewBlockMenuAt]);

  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    openNewBlockMenuAt(e.clientX, e.clientY, "primary");
  }, [openNewBlockMenuAt]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    lastPointerRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    lastPointerRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const closeMenu = useCallback(() => setIsMenuOpen(false), []);

  const createBlockAtMenu = useCallback((type: keyof typeof nodeTypes) => {
    const inst = instanceRef.current;
    if (inst) {
      const flowPos = inst.screenToFlowPosition({ x: menuScreenPos.x, y: menuScreenPos.y });
      addNode(type, flowPos);
    } else {
      addNode(type);
    }
    setIsMenuOpen(false);
  }, [addNode, menuScreenPos]);

  const proOptions = useMemo(() => ({ hideAttribution: true }), []);

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
            + Text Block
          </button>
          <button
            onClick={() => addNode("imageGenerate")}
            className={clsx(
              "w-full py-2 px-3 rounded-md border text-sm",
              "bg-foreground text-background border-foreground/20 hover:opacity-90"
            )}
          >
            + Image Block
          </button>
          <button
            onClick={() => addNode("videoGenerate")}
            className={clsx(
              "w-full py-2 px-3 rounded-md border text-sm",
              "bg-foreground text-background border-foreground/20 hover:opacity-90"
            )}
          >
            + Video Block
          </button>
        </div>
        <p className="text-xs text-foreground/60">
          Connect blocks to design flows. Select a block to edit parameters.
        </p>
      </aside>
      <div
        className="w-full h-full relative outline-none"
        ref={wrapperRef}
        onDoubleClick={handleDoubleClick}
        onKeyDown={handleKeyDown}
        onContextMenu={handleContextMenu}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        tabIndex={0}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          proOptions={proOptions}
          zoomOnDoubleClick={false}
          zoomOnScroll={false}
          zoomOnPinch
          panOnScroll
          selectionOnDrag
          selectionMode={SelectionMode.Partial}
          panOnDrag={false}
          translateExtent={[[ -100000, -100000 ], [ 100000, 100000 ]]}
          defaultViewport={{ x: 0, y: 0, zoom: 1 }}
          onInit={(instance) => {
            instanceRef.current = instance;
          }}
        >
          <Background />
        </ReactFlow>
        {isMenuOpen ? (
          <div
            className="absolute z-50 bg-background border rounded-md shadow-lg overflow-hidden"
            style={{
              left: menuScreenPos.x - (wrapperRef.current?.getBoundingClientRect().left ?? 0),
              top: menuScreenPos.y - (wrapperRef.current?.getBoundingClientRect().top ?? 0),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {menuStage === "primary" ? (
              <button
                className="block w-full text-left px-3 py-2 text-sm hover:bg-foreground/10"
                onClick={() => setMenuStage("type")}
              >
                New Block
              </button>
            ) : (
              <>
                <div className="text-xs px-3 py-2 border-b">New Block</div>
                <button className="block w-full text-left px-3 py-2 text-sm hover:bg-foreground/10" onClick={() => createBlockAtMenu("textGenerate")}>
                  Text
                </button>
                <button className="block w-full text-left px-3 py-2 text-sm hover:bg-foreground/10" onClick={() => createBlockAtMenu("imageGenerate")}>
                  Image
                </button>
                <button className="block w-full text-left px-3 py-2 text-sm hover:bg-foreground/10" onClick={() => createBlockAtMenu("videoGenerate")}>
                  Video
                </button>
              </>
            )}
          </div>
        ) : null}
        {isMenuOpen ? (
          <div className="absolute inset-0" onClick={closeMenu} />
        ) : null}
      </div>
    </div>
  );
}

export default Studio;