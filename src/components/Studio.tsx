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

  // Connect-drag ephemeral state
  const connectStartRef = useRef<null | { nodeId: string; handleType: "source" | "target" }>(null);
  const connectSucceededRef = useRef(false);
  const [isConnectMenuOpen, setIsConnectMenuOpen] = useState(false);
  const [connectMenuScreenPos, setConnectMenuScreenPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [showConnectOverlay, setShowConnectOverlay] = useState(false);
  const [connectOverlayStart, setConnectOverlayStart] = useState<{ x: number; y: number } | null>(null);
  const [connectOverlayEnd, setConnectOverlayEnd] = useState<{ x: number; y: number } | null>(null);

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
    (connection: Connection) => {
      // Enforce: only a single text block can connect into an image/video as prompt source
      const sourceNode = nodes.find((n) => n.id === connection.source);
      const targetNode = nodes.find((n) => n.id === connection.target);
      const isTextToMedia = (sourceNode?.type === "textGenerate") && (targetNode?.type === "imageGenerate" || targetNode?.type === "videoGenerate");
      if (isTextToMedia) {
        const alreadyHasText = edges.some((e) => e.target === connection.target && nodes.find((n) => n.id === e.source)?.type === "textGenerate");
        if (alreadyHasText) {
          // Disallow adding another text->media prompt link
          return;
        }
      }
      setEdges((eds) => addEdge(connection, eds));
      connectSucceededRef.current = true;
      // End any overlay/menu when a real connection is made
      setShowConnectOverlay(false);
      setIsConnectMenuOpen(false);
      setConnectOverlayStart(null);
      setConnectOverlayEnd(null);
    },
    [setEdges, nodes, edges]
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
    if (showConnectOverlay && !isConnectMenuOpen) {
      setConnectOverlayEnd({ x: e.clientX, y: e.clientY });
    }
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    lastPointerRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const closeMenu = useCallback(() => setIsMenuOpen(false), []);

  // Node data updates from node components
  const updateNodeData = useCallback((nodeId: string, partial: Record<string, unknown>) => {
    setNodes((prev) => prev.map((n) => (n.id === nodeId ? { ...n, data: { ...(n.data as Record<string, unknown>), ...partial } } : n)));
  }, [setNodes]);

  // Programmatically select a node (used by toolbars)
  const selectNode = useCallback((nodeId: string) => {
    setNodes((prev) => prev.map((n) => ({ ...n, selected: n.id === nodeId })));
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
    const a = document.createElement("a");
    // If it's a data URL, link directly to avoid very long query strings
    if (url.startsWith("data:")) {
      a.href = url;
      a.download = filename;
    } else {
      // Use server-side proxy to avoid CORS and force attachment
      const proxyUrl = `/api/download?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}`;
      a.href = proxyUrl;
      a.download = filename;
    }
    document.body.appendChild(a);
    a.click();
    a.remove();
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

  // Create block from connect-drop menu and wire edge according to drag direction
  const createBlockFromConnect = useCallback((type: keyof typeof nodeTypes) => {
    const inst = instanceRef.current;
    const start = connectStartRef.current;
    if (!inst || !start) return;
    const { dx, dy } = getSpawnOffset();
    const flowPos = inst.screenToFlowPosition({ x: connectMenuScreenPos.x, y: connectMenuScreenPos.y });
    const newId = `${idRef.current++}`;
    const newNode: Node = { id: newId, type, position: { x: flowPos.x + dx, y: flowPos.y + dy }, data: {} } as Node;
    setNodes((nds) => nds.concat(newNode));
    // Wire edge based on which handle we started from
    setEdges((eds) => addEdge(
      start.handleType === "source"
        ? { id: `${start.nodeId}-${newId}`, source: start.nodeId, target: newId }
        : { id: `${newId}-${start.nodeId}`, source: newId, target: start.nodeId },
      eds
    ));
    setIsConnectMenuOpen(false);
    connectStartRef.current = null;
    setShowConnectOverlay(false);
    setConnectOverlayStart(null);
    setConnectOverlayEnd(null);
  }, [getSpawnOffset, connectMenuScreenPos]);

  const pasteAtCanvasMenu = useCallback(() => {
    if (!nodeClipboard) return;
    pasteAtScreenPosition(menuScreenPos.x, menuScreenPos.y);
    setIsMenuOpen(false);
  }, [nodeClipboard, menuScreenPos, pasteAtScreenPosition]);

  const proOptions = useMemo(() => ({ hideAttribution: true }), []);

  // Context resolver for text nodes: combine incoming text prompts in order of edges
  const resolveContextText = useCallback((nodeId: string): string => {
    const incoming = edges.filter((e) => e.target === nodeId).map((e) => nodes.find((n) => n.id === e.source)).filter(Boolean) as Node[];
    const incomingText = incoming.filter((n) => n.type === "textGenerate");
    const parts = incomingText.map((n) => (n.data as any)?.output).filter((p): p is string => typeof p === "string" && p.length > 0);
    return parts.join("\n\n");
  }, [edges, nodes]);

  // Collect upstream image URLs for a given node (used by text blocks for multimodal context)
  const resolveContextImages = useCallback((nodeId: string): string[] => {
    const incoming = edges
      .filter((e) => e.target === nodeId)
      .map((e) => nodes.find((n) => n.id === e.source))
      .filter(Boolean) as Node[];
    const incomingImages = incoming.filter((n) => n.type === "imageGenerate");
    const urls = incomingImages
      .map((n) => (n.data as any)?.imageUrl)
      .filter((u): u is string => typeof u === "string" && u.length > 0);
    return urls;
  }, [edges, nodes]);

  // Apply prompt locking to media nodes based on incoming text connection
  useEffect(() => {
    setNodes((prev) => {
      let changed = false;
      const next = prev.map((node) => {
        if (node.type !== "imageGenerate" && node.type !== "videoGenerate") return node;
        const incomingTextEdges = edges.filter((e) => e.target === node.id && nodes.find((n) => n.id === e.source)?.type === "textGenerate");
        const existingLocked = Boolean((node.data as any)?.promptLocked);
        if (incomingTextEdges.length === 0) {
          if (existingLocked) {
            changed = true;
            return { ...node, data: { ...(node.data as any), promptLocked: false, promptLockedSourceId: "" } } as Node;
          }
          return node;
        }
        // There is at least one text source. Use the first one.
        const srcId = incomingTextEdges[0].source!;
        const srcNode = nodes.find((n) => n.id === srcId);
        const srcOutput = (srcNode?.data as any)?.output ?? "";
        const currentPrompt = (node.data as any)?.prompt;
        if (!existingLocked || currentPrompt !== srcOutput || (node.data as any)?.promptLockedSourceId !== srcId) {
          changed = true;
          return { ...node, data: { ...(node.data as any), prompt: srcOutput, promptLocked: true, promptLockedSourceId: srcId } } as Node;
        }
        return node;
      });
      return changed ? next : prev;
    });
  }, [edges, nodes, setNodes]);

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
              _select: selectNode,
                _resolveContextText: resolveContextText,
                _resolveContextImages: resolveContextImages,
            },
          })) as unknown as Node[]}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
            onConnectStart={(event, params) => {
              connectSucceededRef.current = false;
              connectStartRef.current = { nodeId: params?.nodeId ?? "", handleType: (params?.handleType as any) ?? "source" };
              const mouseEvent = event as MouseEvent;
              const sx = mouseEvent.clientX;
              const sy = mouseEvent.clientY;
              setConnectOverlayStart({ x: sx, y: sy });
              setConnectOverlayEnd(lastPointerRef.current ?? { x: sx, y: sy });
              setShowConnectOverlay(true);
            }}
            onConnectEnd={(e) => {
              // If we didn't connect to a node, open TURN INTO menu where the drag ended
              if (!connectSucceededRef.current) {
                const mouseEvent = e as MouseEvent;
                setConnectMenuScreenPos({ x: mouseEvent.clientX, y: mouseEvent.clientY });
                // keep overlay visible while menu is open
                setShowConnectOverlay(true);
                setIsConnectMenuOpen(true);
                setConnectOverlayEnd({ x: mouseEvent.clientX, y: mouseEvent.clientY });
              }
              connectSucceededRef.current = false;
            }}
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

        {/* Lightweight overlay line to keep the thread visible while TURN INTO is open */}
        {showConnectOverlay ? (
          <svg className="pointer-events-none absolute inset-0 z-40" style={{ left: 0, top: 0 }}>
            {(() => {
              const start = connectOverlayStart;
              const end = connectOverlayEnd;
              const wrapRect = wrapperRef.current?.getBoundingClientRect();
              if (!start || !end || !wrapRect) return null;
              const sx = start.x - wrapRect.left;
              const sy = start.y - wrapRect.top;
              const ex = end.x - wrapRect.left;
              const ey = end.y - wrapRect.top;
              return (
                <line x1={sx} y1={sy} x2={ex} y2={ey} stroke="currentColor" opacity="0.4" strokeWidth="2" />
              );
            })()}
          </svg>
        ) : null}

        {isConnectMenuOpen ? (
          <div
            className="absolute z-50 bg-background border rounded-md shadow-lg overflow-hidden"
            style={{
              left: connectMenuScreenPos.x - (wrapperRef.current?.getBoundingClientRect().left ?? 0),
              top: connectMenuScreenPos.y - (wrapperRef.current?.getBoundingClientRect().top ?? 0),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-[11px] px-3 py-2 border-b text-foreground/60 tracking-wide">TURN INTO</div>
            <button className="block w-full text-left px-3 py-2 text-sm hover:bg-foreground/10" onClick={() => createBlockFromConnect("textGenerate")}>
              Text
            </button>
            <button className="block w-full text-left px-3 py-2 text-sm hover:bg-foreground/10" onClick={() => createBlockFromConnect("imageGenerate")}>
              Image
            </button>
            <button className="block w-full text-left px-3 py-2 text-sm hover:bg-foreground/10" onClick={() => createBlockFromConnect("videoGenerate")}>
              Video
            </button>
          </div>
        ) : null}
        {isConnectMenuOpen ? (
          <div className="absolute inset-0" onClick={() => { setIsConnectMenuOpen(false); connectStartRef.current = null; setShowConnectOverlay(false); setConnectOverlayStart(null); setConnectOverlayEnd(null); }} />
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