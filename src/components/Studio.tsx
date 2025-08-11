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

  // Node context menu state
  const [isNodeMenuOpen, setIsNodeMenuOpen] = useState(false);
  const [nodeMenuScreenPos, setNodeMenuScreenPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [nodeMenuTargetId, setNodeMenuTargetId] = useState<string | null>(null);

  // In-app clipboard for copy/paste of nodes
  const [nodeClipboard, setNodeClipboard] = useState<null | { type: keyof typeof nodeTypes; data: Record<string, unknown> }>(null);

  // Offset control to avoid overlapping on repeated paste/duplicate
  const spawnCounterRef = useRef(0);

  const getSpawnOffset = useCallback(() => {
    const c = spawnCounterRef.current++;
    const dx = 24 + (c % 4) * 12; // 24,36,48,60
    const dy = 16 + ((Math.floor(c / 4)) % 4) * 10; // 16,26,36,46 cycles
    return { dx, dy };
  }, []);

  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge(connection, eds)),
    [setEdges]
  );

  const addNode = useCallback(
    (type: keyof typeof nodeTypes, position?: { x: number; y: number }) => {
      const id = `${idRef.current++}`;
      const nodePosition = position ?? { x: 200 + Math.random() * 200, y: 100 + Math.random() * 200 };
      const data = {} as Record<string, unknown>;
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

  const getSelectedNode = useCallback(() => nodes.find((n) => (n as any).selected), [nodes]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
      return;
    }

    const isMod = e.metaKey || e.ctrlKey;
    if (isMod && (e.key === "c" || e.key === "C")) {
      e.preventDefault();
      const selected = getSelectedNode();
      if (selected) {
        const n = selected;
        setNodeClipboard({ type: n.type as keyof typeof nodeTypes, data: { ...(n.data as Record<string, unknown>) } });
      }
      return;
    }
    if (isMod && (e.key === "v" || e.key === "V")) {
      e.preventDefault();
      if (!nodeClipboard) return;
      const base = lastPointerRef.current ?? (() => {
        const bounds = wrapperRef.current?.getBoundingClientRect();
        return { x: (bounds?.left ?? 0) + (bounds?.width ?? 0) / 2, y: (bounds?.top ?? 0) + (bounds?.height ?? 0) / 2 };
      })();
      pasteAtScreenPosition(base.x, base.y);
      return;
    }
    if (isMod && (e.key === "d" || e.key === "D")) {
      e.preventDefault();
      const sel = getSelectedNode();
      if (sel) {
        const { dx, dy } = getSpawnOffset();
        const id = `${idRef.current++}`;
        const position = { x: sel.position.x + 380 + dx, y: sel.position.y + dy };
        const newNode: Node = { id, type: sel.type as keyof typeof nodeTypes, position, data: { ...(sel.data as Record<string, unknown>) } } as Node;
        setNodes((nds) => nds.concat(newNode));
      }
      return;
    }

    if (e.code === "Space") {
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
  }, [getSelectedNode, nodeClipboard, getSpawnOffset, openNewBlockMenuAt]);

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

  // Node data updates from node components
  const updateNodeData = useCallback((nodeId: string, partial: Record<string, unknown>) => {
    setNodes((prev) => prev.map((n) => (n.id === nodeId ? { ...n, data: { ...(n.data as Record<string, unknown>), ...partial } } : n)));
  }, [setNodes]);

  // Open node context menu from node component
  const openNodeContextMenu = useCallback((nodeId: string, clientX: number, clientY: number) => {
    setNodeMenuTargetId(nodeId);
    setNodeMenuScreenPos({ x: clientX, y: clientY });
    setIsNodeMenuOpen(true);
  }, []);

  const closeNodeMenu = useCallback(() => setIsNodeMenuOpen(false), []);

  // Helpers
  const getNodeById = useCallback((id: string | null) => nodes.find((n) => n.id === id), [nodes]);

  const duplicateNode = useCallback((targetId: string) => {
    const source = nodes.find((n) => n.id === targetId);
    if (!source) return;
    const id = `${idRef.current++}`;
    const { dx, dy } = getSpawnOffset();
    const position = { x: source.position.x + 380 + dx, y: source.position.y + dy };
    // Include full data clone
    const clonedData = { ...(source.data as Record<string, unknown>) };
    const newNode: Node = { id, type: source.type as keyof typeof nodeTypes, position, data: clonedData } as Node;
    setNodes((nds) => nds.concat(newNode));
  }, [nodes, setNodes, getSpawnOffset]);

  const pasteNodeAtPointer = useCallback(() => {
    if (!nodeClipboard) return;
    const base = lastPointerRef.current ?? (() => {
      const bounds = wrapperRef.current?.getBoundingClientRect();
      return { x: (bounds?.left ?? 0) + (bounds?.width ?? 0) / 2, y: (bounds?.top ?? 0) + (bounds?.height ?? 0) / 2 };
    })();
    pasteAtScreenPosition(base.x, base.y);
  }, [nodeClipboard]);

  const copyNode = useCallback((targetId: string) => {
    const n = nodes.find((x) => x.id === targetId);
    if (!n) return;
    setNodeClipboard({ type: n.type as keyof typeof nodeTypes, data: { ...(n.data as Record<string, unknown>) } });
  }, [nodes]);

  const deleteNode = useCallback((targetId: string) => {
    setNodes((nds) => nds.filter((n) => n.id !== targetId));
    setEdges((eds) => eds.filter((e) => e.source !== targetId && e.target !== targetId));
  }, [setNodes, setEdges]);

  const downloadMedia = useCallback(async (url: string, filename: string) => {
    try {
      // Try to fetch and download as blob for cross-origin robustness
      const res = await fetch(url);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      // Fallback: direct download attempt
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  }, []);

  // Paste helper at exact screen coordinates
  const pasteAtScreenPosition = useCallback((clientX: number, clientY: number) => {
    if (!nodeClipboard) return;
    const inst = instanceRef.current;
    if (!inst) return;
    const flowPos = inst.screenToFlowPosition({ x: clientX, y: clientY });
    const id = `${idRef.current++}`;
    const newNode: Node = {
      id,
      type: nodeClipboard.type,
      position: { x: flowPos.x, y: flowPos.y },
      data: { ...(nodeClipboard.data as Record<string, unknown>) },
    } as Node;
    setNodes((nds) => nds.concat(newNode));
  }, [nodeClipboard]);

  const createBlockAtMenu = useCallback((type: keyof typeof nodeTypes) => {
    const inst = instanceRef.current;
    if (inst) {
      const { dx, dy } = getSpawnOffset();
      const flowPos = inst.screenToFlowPosition({ x: menuScreenPos.x, y: menuScreenPos.y });
      addNode(type, { x: flowPos.x + dx, y: flowPos.y + dy });
    } else {
      addNode(type);
    }
    setIsMenuOpen(false);
  }, [addNode, menuScreenPos, getSpawnOffset]);

  const pasteAtCanvasMenu = useCallback(() => {
    if (!nodeClipboard) return;
    pasteAtScreenPosition(menuScreenPos.x, menuScreenPos.y);
    setIsMenuOpen(false);
  }, [nodeClipboard, menuScreenPos, pasteAtScreenPosition]);

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
          nodes={nodes.map((n) => ({
            ...n,
            data: {
              ...(n.data as Record<string, unknown>),
              _update: updateNodeData,
              _openMenu: openNodeContextMenu,
            },
          })) as unknown as Node[]}
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
          minZoom={0.25}
          defaultViewport={{ x: 0, y: 0, zoom: 1 }}
          onInit={(instance) => {
            instanceRef.current = instance as unknown as ReactFlowInstance;
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
              <div className="py-1 text-sm">
                <button
                  className="flex items-center justify-between gap-6 w-full text-left px-3 py-2 hover:bg-foreground/10"
                  onClick={() => setMenuStage("type")}
                >
                  <span>New Block</span>
                </button>
                <div className="my-1 border-t" />
                <button
                  disabled={!nodeClipboard}
                  className={clsx("flex items-center justify-between gap-6 w-full text-left px-3 py-2", nodeClipboard ? "hover:bg-foreground/10" : "opacity-50 cursor-not-allowed")}
                  onClick={pasteAtCanvasMenu}
                >
                  <span>Paste</span>
                  <span className="text-foreground/50">⌘V</span>
                </button>
              </div>
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

        {isNodeMenuOpen && nodeMenuTargetId ? (
          <div
            className="absolute z-50 bg-background border rounded-md shadow-lg overflow-hidden min-w-[160px]"
            style={{
              left: nodeMenuScreenPos.x - (wrapperRef.current?.getBoundingClientRect().left ?? 0),
              top: nodeMenuScreenPos.y - (wrapperRef.current?.getBoundingClientRect().top ?? 0),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {(() => {
              const node = getNodeById(nodeMenuTargetId);
              const nodeType = node?.type as keyof typeof nodeTypes | undefined;
              const data = (node?.data as Record<string, unknown>) || {};
              const isImage = nodeType === "imageGenerate";
              const isVideo = nodeType === "videoGenerate";
              const canDownload = (isImage && typeof data.imageUrl === "string" && (data.imageUrl as string).length > 0) ||
                (isVideo && typeof data.videoUrl === "string" && (data.videoUrl as string).length > 0);
              return (
                <div className="py-1 text-sm">
                  <button
                    className="flex items-center justify-between gap-6 w-full text-left px-3 py-2 hover:bg-foreground/10"
                    onClick={() => {
                      copyNode(nodeMenuTargetId);
                      setIsNodeMenuOpen(false);
                    }}
                  >
                    <span>Copy</span>
                    <span className="text-foreground/50">⌘C</span>
                  </button>
                  <button
                    disabled={!nodeClipboard}
                    className={clsx("flex items-center justify-between gap-6 w-full text-left px-3 py-2", nodeClipboard ? "hover:bg-foreground/10" : "opacity-50 cursor-not-allowed")}
                    onClick={() => {
                      pasteNodeAtPointer();
                      setIsNodeMenuOpen(false);
                    }}
                  >
                    <span>Paste</span>
                    <span className="text-foreground/50">⌘V</span>
                  </button>
                  <button
                    className="flex items-center justify-between gap-6 w-full text-left px-3 py-2 hover:bg-foreground/10"
                    onClick={() => {
                      duplicateNode(nodeMenuTargetId);
                      setIsNodeMenuOpen(false);
                    }}
                  >
                    <span>Duplicate</span>
                    <span className="text-foreground/50">⌘D</span>
                  </button>
                  {canDownload ? (
                    <button
                      className="flex items-center justify-between gap-6 w-full text-left px-3 py-2 hover:bg-foreground/10"
                      onClick={() => {
                        const url = (isImage ? (data.imageUrl as string) : (data.videoUrl as string))!;
                        const filename = isImage ? `image-${nodeMenuTargetId}.png` : `video-${nodeMenuTargetId}.mp4`;
                        downloadMedia(url, filename);
                        setIsNodeMenuOpen(false);
                      }}
                    >
                      <span>Download</span>
                      <span className="text-foreground/50" />
                    </button>
                  ) : null}
                  <div className="my-1 border-t" />
                  <button
                    className="w-full text-left px-3 py-2 text-red-600 hover:bg-red-600/10"
                    onClick={() => {
                      deleteNode(nodeMenuTargetId);
                      setIsNodeMenuOpen(false);
                    }}
                  >
                    Delete
                  </button>
                </div>
              );
            })()}
          </div>
        ) : null}
        {isNodeMenuOpen ? <div className="absolute inset-0" onClick={closeNodeMenu} /> : null}
      </div>
    </div>
  );
}

export default Studio;