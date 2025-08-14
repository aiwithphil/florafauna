"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Handle, Position, NodeProps } from "@xyflow/react";

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

export function ImageGenerateNode({ id, data, selected }: NodeProps) {
  const d = (data as Record<string, unknown>) || {};
  const update = (d as any)?._update as ((nodeId: string, partial: Record<string, unknown>) => void) | undefined;
  const openMenu = (d as any)?._openMenu as ((nodeId: string, x: number, y: number) => void) | undefined;
  const selectNode = (d as any)?._select as ((nodeId: string) => void) | undefined;
  const resolveContextText = (d as any)?._resolveContextText as ((nodeId: string) => string) | undefined;
  const hasIncomingImageSource = (d as any)?._hasIncomingImageSource as ((nodeId: string) => boolean) | undefined;
  const countIncomingImages = (d as any)?._countIncomingImages as ((nodeId: string) => number) | undefined;
  const resolveContextImages = (d as any)?._resolveContextImages as ((nodeId: string) => string[]) | undefined;
  const initialPrompt = asString(d["prompt"], "A watercolor painting of a fern in a misty forest");
  const initialImgRatio = asString(d["imgRatio"], "1:1");
  const initialImgRatioApplied = asString((d as any)?.imgRatioApplied, initialImgRatio);
  const initialImgModel = asString(d["imgModel"], "GPT Image");
  const [prompt, setPrompt] = useState<string>(initialPrompt);
  const [imageUrl, setImageUrl] = useState<string | null>((typeof d["imageUrl"] === "string" ? (d["imageUrl"] as string) : null));
  const promptLocked = Boolean((d as any)?.promptLocked);
  const [isLoading, setIsLoading] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isToolbarHover, setIsToolbarHover] = useState(false);
  const [isBridgeHover, setIsBridgeHover] = useState(false);
  // Separate the selected ratio (used for next generation) from the applied ratio (used to size the current image container)
  const [imgRatioSelected, setImgRatioSelected] = useState(initialImgRatio);
  const [imgRatioApplied, setImgRatioApplied] = useState(initialImgRatioApplied);
  const [imgModel, setImgModel] = useState(initialImgModel);
  const [openWhich, setOpenWhich] = useState<null | "ratio" | "model">(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const isImageToImage = Boolean(hasIncomingImageSource?.(id));
  const incomingImageCount = countIncomingImages?.(id) ?? 0;

  const textToImageModels = React.useMemo(
    () => [
      "GPT Image",
      "Flux Dev",
      "Flux Kontext Max",
      "Flux Pro 1.1 Ultra",
      "Imagen 4",
      "Ideogram 3.0",
    ],
    []
  );
  // Base i2i capability set when 1 image is connected
  const imageToImageModelsBase = React.useMemo(
    () => [
      "GPT Image",
      "Ideogram Character",
      "Flux Kontext Max",
      "Imagen 3",
      "Runway References",
      "Flux Canny",
      "Flux Depth",
      "Flux Redux",
      "Topaz",
    ],
    []
  );

  // Restrict i2i models based on number of incoming images
  const imageToImageModels = React.useMemo(() => {
    if (!isImageToImage) return [] as string[];
    const n = incomingImageCount;
    if (n <= 1) return imageToImageModelsBase;
    if (n === 2) return ["GPT Image", "Ideogram Character", "Flux Kontext Max", "Runway References"];
    if (n === 3) return ["GPT Image", "Flux Kontext Max", "Runway References"];
    if (n === 4) return ["GPT Image", "Flux Kontext Max"];
    if (n === 5) return ["GPT Image", "Flux Kontext Max"];
    if (n === 6) return ["GPT Image"];
    if (n === 7) return ["GPT Image"];
    if (n === 8) return ["GPT Image"];
    if (n === 9) return ["GPT Image"];
    return ["GPT Image"]; // n >= 10
  }, [isImageToImage, incomingImageCount, imageToImageModelsBase]);

  // Normalize model selection when the allowed set changes with connections
  useEffect(() => {
    if (isImageToImage) {
      if (!imageToImageModels.includes(imgModel)) {
        const next = imageToImageModels[0] ?? "GPT Image";
        setImgModel(next);
        update?.(id, { imgModel: next });
      }
    } else {
      if (!textToImageModels.includes(imgModel)) {
        const next = textToImageModels[0] ?? "GPT Image";
        setImgModel(next);
        update?.(id, { imgModel: next });
      }
    }
  }, [isImageToImage, imgModel, imageToImageModels, textToImageModels, id, update]);
  function sanitizeEnhancedPrompt(text: string): string {
    let s = (text ?? "").trim();
    s = s.replace(/^\s*(\*\*)?\s*Enhanced Prompt:?\s*(\*\*)?\s*\n*/i, "");
    s = s.replace(/\*\*/g, "");
    s = s
      .split("\n")
      .map((line) => line.replace(/^\s*(?:[-*•]\s*)?(?:\[\s*[xX]?\s*\]\s*)?/, ""))
      .join("\n");
    return s.trim();
  }

  // Sync local prompt view when locked and upstream text output updates
  useEffect(() => {
    const dataPrompt = asString(d["prompt"], prompt);
    if (promptLocked && dataPrompt !== prompt) {
      setPrompt(dataPrompt);
    }
  }, [promptLocked, d, prompt]);

  type SizeOption = { label: string; value: string };
  type SizeGroup = { heading: string; options: SizeOption[] };

  function parseAspect(value: string): [number, number] | null {
    if (!value.includes(":")) return null;
    const [wStr, hStr] = value.split(":");
    const w = Number(wStr);
    const h = Number(hStr);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
    return [w, h];
  }

  function AspectIcon({ value }: { value: string }) {
    if (value === "auto") {
      return (
        <svg className="w-5 h-4" viewBox="0 0 24 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
          <rect x="1" y="1" width="22" height="14" rx="2" stroke="#fff" strokeDasharray="2 2" />
          <text x="12" y="11" textAnchor="middle" fontSize="8" fill="#fff">A</text>
        </svg>
      );
    }
    const parsed = parseAspect(value);
    const boxW = 24;
    const boxH = 16;
    const pad = 2;
    if (!parsed) {
      return (
        <svg className="w-5 h-4" viewBox="0 0 24 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
          <rect x="1" y="1" width="22" height="14" rx="2" stroke="#fff" />
        </svg>
      );
    }
    const [w, h] = parsed;
    const maxDim = Math.max(w, h);
    const innerAvailW = boxW - pad * 2;
    const innerAvailH = boxH - pad * 2;
    const innerW = Math.max(4, Math.round((w / maxDim) * innerAvailW));
    const innerH = Math.max(4, Math.round((h / maxDim) * innerAvailH));
    const innerX = Math.round((boxW - innerW) / 2);
    const innerY = Math.round((boxH - innerH) / 2);
    return (
      <svg className="w-5 h-4" viewBox="0 0 24 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
        <rect x="1" y="1" width="22" height="14" rx="2" stroke="#fff" />
        <rect x={innerX} y={innerY} width={innerW} height={innerH} rx="1" fill="#fff" />
      </svg>
    );
  }

  const sizeGroups: SizeGroup[] = React.useMemo(() => {
    // GPT Image
    if (imgModel === "GPT Image") {
      return [
        { heading: "Auto", options: [{ label: "Auto", value: "auto" }] },
        { heading: "Square", options: [{ label: "1:1", value: "1:1" }] },
        { heading: "Horizontal", options: [{ label: "3:2", value: "3:2" }] },
        { heading: "Vertical", options: [{ label: "2:3", value: "2:3" }] },
      ];
    }

    // Flux Dev
    if (imgModel === "Flux Dev") {
      return [
        { heading: "Square", options: [{ label: "1:1", value: "1:1" }] },
        { heading: "Horizontal", options: [{ label: "16:9", value: "16:9" }, { label: "4:3", value: "4:3" }] },
        { heading: "Vertical", options: [{ label: "3:4", value: "3:4" }, { label: "9:16", value: "9:16" }] },
      ];
    }

    // Flux Kontext Max (add Auto in image-to-image mode)
    if (imgModel === "Flux Kontext Max") {
      return [
        ...(isImageToImage ? [{ heading: "Auto", options: [{ label: "Auto", value: "auto" }] }] as SizeGroup[] : []),
        { heading: "Square", options: [{ label: "1:1", value: "1:1" }] },
        { heading: "Horizontal", options: [
          { label: "21:9", value: "21:9" },
          { label: "16:9", value: "16:9" },
          { label: "4:3", value: "4:3" },
          { label: "3:2", value: "3:2" },
        ] },
        { heading: "Vertical", options: [
          { label: "2:3", value: "2:3" },
          { label: "3:4", value: "3:4" },
          { label: "9:16", value: "9:16" },
          { label: "9:21", value: "9:21" },
        ] },
      ];
    }

    // Flux Pro 1.1 / Ultra
    if (imgModel === "Flux Pro 1.1" || imgModel === "Flux Pro 1.1 Ultra") {
      return [
        { heading: "Square", options: [{ label: "1:1", value: "1:1" }] },
        { heading: "Horizontal", options: [
          { label: "21:9", value: "21:9" },
          { label: "16:9", value: "16:9" },
          { label: "4:3", value: "4:3" },
          { label: "3:2", value: "3:2" },
        ] },
        { heading: "Vertical", options: [
          { label: "2:3", value: "2:3" },
          { label: "3:4", value: "3:4" },
          { label: "9:16", value: "9:16" },
          { label: "9:21", value: "9:21" },
        ] },
      ];
    }

    // Imagen 4
    if (imgModel === "Imagen 4") {
      return [
        { heading: "Square", options: [{ label: "1:1", value: "1:1" }] },
        { heading: "Horizontal", options: [
          { label: "4:3", value: "4:3" },
          { label: "16:9", value: "16:9" },
        ] },
        { heading: "Vertical", options: [
          { label: "3:4", value: "3:4" },
          { label: "9:16", value: "9:16" },
        ] },
      ];
    }

    // Ideogram 3.0
    if (imgModel === "Ideogram 3.0") {
      return [
        { heading: "Square", options: [{ label: "1:1", value: "1:1" }] },
        { heading: "Horizontal", options: [
          { label: "3:1", value: "3:1" },
          { label: "16:10", value: "16:10" },
          { label: "16:9", value: "16:9" },
          { label: "3:2", value: "3:2" },
          { label: "4:3", value: "4:3" },
        ] },
        { heading: "Vertical", options: [
          { label: "3:4", value: "3:4" },
          { label: "2:3", value: "2:3" },
          { label: "9:16", value: "9:16" },
          { label: "10:16", value: "10:16" },
          { label: "1:3", value: "1:3" },
        ] },
      ];
    }

    // Image-to-Image specific models
    if (imgModel === "Ideogram Character") {
      return [
        { heading: "Auto", options: [{ label: "Auto", value: "auto" }] },
        // same sizes as Ideogram 3.0
        { heading: "Square", options: [{ label: "1:1", value: "1:1" }] },
        { heading: "Horizontal", options: [
          { label: "3:1", value: "3:1" },
          { label: "16:10", value: "16:10" },
          { label: "16:9", value: "16:9" },
          { label: "3:2", value: "3:2" },
          { label: "4:3", value: "4:3" },
        ] },
        { heading: "Vertical", options: [
          { label: "3:4", value: "3:4" },
          { label: "2:3", value: "2:3" },
          { label: "9:16", value: "9:16" },
          { label: "10:16", value: "10:16" },
          { label: "1:3", value: "1:3" },
        ] },
      ];
    }

    if (imgModel === "Imagen 3") {
      return [
        { heading: "Auto", options: [{ label: "Auto", value: "auto" }] },
        { heading: "Square", options: [{ label: "1:1", value: "1:1" }] },
        { heading: "Horizontal", options: [
          { label: "4:3", value: "4:3" },
          { label: "16:9", value: "16:9" },
        ] },
        { heading: "Vertical", options: [
          { label: "3:4", value: "3:4" },
          { label: "9:16", value: "9:16" },
        ] },
      ];
    }

    if (imgModel === "Runway References") {
      return [
        { heading: "Auto", options: [{ label: "Auto", value: "auto" }] },
        { heading: "Square", options: [{ label: "1:1", value: "1:1" }] },
        { heading: "Horizontal", options: [
          { label: "21:9", value: "21:9" },
          { label: "16:9", value: "16:9" },
          { label: "4:3", value: "4:3" },
        ] },
        { heading: "Vertical", options: [
          { label: "9:16", value: "9:16" },
          { label: "3:4", value: "3:4" },
        ] },
      ];
    }

    if (imgModel === "Flux Canny" || imgModel === "Flux Depth" || imgModel === "Flux Redux") {
      return [
        { heading: "Auto", options: [{ label: "Auto", value: "auto" }] },
        { heading: "Square", options: [{ label: "1:1", value: "1:1" }] },
        { heading: "Horizontal", options: [
          { label: "16:9", value: "16:9" },
          { label: "4:3", value: "4:3" },
        ] },
        { heading: "Vertical", options: [
          { label: "3:4", value: "3:4" },
          { label: "9:16", value: "9:16" },
        ] },
      ];
    }

    if (imgModel === "Topaz") {
      // No sizes – upscaler; leave empty to hide options logic or keep Auto only
      return [];
    }

    // Fallback: previous flat options under a generic heading
    return [
      {
        heading: "Sizes",
        options: [
          { label: "Auto", value: "auto" },
          { label: "1:1", value: "1:1" },
          { label: "3:2", value: "3:2" },
          { label: "2:3", value: "2:3" },
        ],
      },
    ];
  }, [imgModel, isImageToImage]);

  // Ensure currently selected ratio is valid for the chosen model; if not, default to the first option
  useEffect(() => {
    const allOptions = sizeGroups.flatMap((g) => g.options.map((o) => o.value));
    if (allOptions.length === 0) return;
    if (!allOptions.includes(imgRatioSelected)) {
      const next = allOptions[0];
      setImgRatioSelected(next);
      update?.(id, { imgRatio: next, imgRatioSelected: next });
    }
  }, [imgModel, sizeGroups, imgRatioSelected, id, update]);

  const ratioLabel = (value: string) => {
    switch (value) {
      case "auto":
        return "Auto";
      case "1:1":
        return "1:1 (square)";
      case "3:2":
        return "3:2 (horizontal)";
      case "2:3":
        return "2:3 (vertical)";
      default:
        return value;
    }
  };

  useEffect(() => {
    update?.(id, {
      prompt: initialPrompt,
      imageUrl: imageUrl ?? "",
      imgRatio: initialImgRatio, // legacy field for backward compatibility
      imgRatioSelected: imgRatioSelected,
      imgRatioApplied: imgRatioApplied,
      imgModel: initialImgModel,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onDocDown(e: MouseEvent) {
      if (!toolbarRef.current) return;
      if (!toolbarRef.current.contains(e.target as Node)) setOpenWhich(null);
    }
    if (openWhich) {
      document.addEventListener("mousedown", onDocDown);
      return () => document.removeEventListener("mousedown", onDocDown);
    }
  }, [openWhich]);

  useEffect(() => {
    if (!selected) {
      setIsToolbarHover(false);
      setIsBridgeHover(false);
      setOpenWhich(null);
    }
  }, [selected]);

  const run = useCallback(async () => {
    setIsLoading(true);
    try {
      const context = resolveContextText?.(id) ?? "";
      const effectivePrompt = promptLocked ? prompt : (context ? `${context}\n\n${prompt}` : prompt);
      function mapRatioToGptSize(ratio: string): string | undefined {
        switch (ratio) {
          case "auto":
            return "auto";
          case "1:1":
            return "1024x1024";
          case "3:2":
            return "1536x1024";
          case "2:3":
            return "1024x1536";
          default:
            return undefined;
        }
      }

      // Apply the selected ratio for display when a new generation starts
      setImgRatioApplied(imgRatioSelected);
      update?.(id, { imgRatioApplied: imgRatioSelected });

      const isFlux = imgModel.startsWith("Flux ");
      const isImagen = imgModel.startsWith("Imagen ");
      const isIdeogram = imgModel.startsWith("Ideogram");
      const endpoint = isFlux
        ? "/api/generate-image/flux"
        : isImagen
        ? "/api/generate-image/imagen"
        : isIdeogram
        ? "/api/generate-image/ideogram"
        : "/api/generate-image";
      const upstreamImages = resolveContextImages?.(id) ?? [];
      const body = isFlux
        ? { prompt: effectivePrompt, model: imgModel, ratio: imgRatioSelected }
        : isImagen
        ? { prompt: effectivePrompt, ratio: imgRatioSelected }
        : isIdeogram
        ? { prompt: effectivePrompt, ratio: imgRatioSelected }
        : {
            prompt: effectivePrompt,
            size: mapRatioToGptSize(imgRatioSelected) ?? "1024x1024",
            ...(isImageToImage && upstreamImages.length > 0 ? { images: upstreamImages.slice(0, 10) } : {}),
          };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.url) {
        setImageUrl(json.url);
        update?.(id, { imageUrl: json.url });
      } else if (json.b64) {
        const url = `data:image/png;base64,${json.b64}`;
        setImageUrl(url);
        update?.(id, { imageUrl: url });
      }
    } finally {
      setIsLoading(false);
    }
  }, [prompt, imgRatioSelected, imgModel, id, update, promptLocked, resolveContextText]);

  const showToolbar = isHovered || !!selected || isToolbarHover || isBridgeHover;
  const promptLockedByModel = imgModel === "Topaz" || imgModel === "Flux Redux";
  const isPromptReadOnly = promptLocked || promptLockedByModel;

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
        // Close dropdowns when clicking back into the block
        setOpenWhich(null);
      }}
    >
      {showToolbar && (
        <div
          className="absolute left-0 right-0 -top-16 h-16"
          onMouseEnter={() => setIsBridgeHover(true)}
          onMouseLeave={() => setIsBridgeHover(false)}
          onMouseDown={(e) => e.stopPropagation()}
        />
      )}
      {showToolbar && (
        <div className="absolute -top-16 left-1/2 -translate-x-1/2 z-10" onMouseEnter={() => setIsToolbarHover(true)} onMouseLeave={() => setIsToolbarHover(false)} onMouseDown={(e) => { setIsToolbarHover(true); e.stopPropagation(); }} onClick={(e) => e.stopPropagation()}>
          <div ref={toolbarRef} className={`relative flex items-center gap-2 rounded-md border bg-background shadow-sm px-3 py-1.5 font-semibold ${selected || isToolbarHover || openWhich ? "opacity-100" : "opacity-70"}`}>
            {/* Ratio */}
            {sizeGroups.length > 0 ? (
              <div className="relative group">
                <button className="text-sm px-3 py-1.5 rounded hover:bg-foreground/10 inline-flex items-center gap-1" onClick={() => { selectNode?.(id); setOpenWhich((w) => (w === "ratio" ? null : "ratio")); }}>
                  <span>{imgRatioSelected === "auto" ? "Auto" : imgRatioSelected}</span>
                  <svg className="w-4 h-4 text-foreground/70" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z" clipRule="evenodd" />
                  </svg>
                </button>
                <div className="pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] text-foreground opacity-0 group-hover:opacity-100 transition-opacity font-semibold">Size</div>
                {openWhich === "ratio" ? (
                  <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1 min-w-[200px] bg-background border rounded-md shadow-lg overflow-hidden text-sm">
                    {sizeGroups.map((group, gi) => (
                      <div key={gi} className={gi > 0 ? "border-t border-foreground/10" : undefined}>
                        <div className="px-3 pt-2 pb-1 text-xs text-foreground/50">{group.heading}</div>
                        {group.options.map((opt) => (
                          <button
                            key={opt.value}
                            className="w-full text-left px-3 py-2 hover:bg-foreground/10 flex items-center gap-2"
                            onClick={() => {
                              // Only apply immediately if we don't yet have an image; otherwise wait until next generation starts
                              setImgRatioSelected(opt.value);
                              if (!imageUrl) {
                                setImgRatioApplied(opt.value);
                              }
                              update?.(id, { imgRatio: opt.value, imgRatioSelected: opt.value, ...(imageUrl ? {} : { imgRatioApplied: opt.value }) });
                              setOpenWhich(null);
                            }}
                          >
                            <span className="inline-flex w-6 justify-center"><AspectIcon value={opt.value} /></span>
                            <span className="flex-1">{opt.label}</span>
                            <span className="inline-flex w-4 justify-end">{imgRatioSelected === opt.value ? "✓" : ""}</span>
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            {/* Model */}
            <div className="relative group">
              <button className="text-sm px-3 py-1.5 rounded hover:bg-foreground/10 inline-flex items-center gap-1" onClick={() => { selectNode?.(id); setOpenWhich((w) => (w === "model" ? null : "model")); }}>
                <span className="whitespace-nowrap">{imgModel}</span>
                <svg className="w-4 h-4 text-foreground/70" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z" clipRule="evenodd" />
                </svg>
              </button>
              <div className="pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] text-foreground opacity-0 group-hover:opacity-100 transition-opacity font-semibold">Model</div>
              {openWhich === "model" ? (
                <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1 min-w-[260px] bg-background border rounded-md shadow-lg overflow-hidden text-sm">
                  {(isImageToImage
                    ? imageToImageModels
                    : [
                        "GPT Image",
                        "Flux Dev",
                        "Flux Kontext Max",
                        "Flux Pro 1.1 Ultra",
                        "Imagen 4",
                        "Ideogram 3.0",
                      ]).map((label) => (
                    <button
                      key={label}
                      className="w-full text-left px-3 py-2 hover:bg-foreground/10 flex items-center justify-between gap-2"
                      onClick={() => {
                        setImgModel(label);
                        update?.(id, { imgModel: label });
                        setOpenWhich(null);
                      }}
                    >
                      <span className="flex items-center gap-2">
                        <span className="inline-block w-4">{imgModel === label ? "✓" : ""}</span>
                        {label}
                      </span>
                      <span className="text-xs">100 credits</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            {/* Enhance prompt */}
            <div className="relative group">
              <button
                className="text-xs px-2 py-1 rounded hover:bg-foreground/10 disabled:opacity-60"
                title="Enhance prompt"
                disabled={isEnhancing}
                onClick={async () => {
                  try {
                    setIsEnhancing(true);
                    const instruction =
                      "You are an AI prompt enhancer for text-to-image generation. Take the user’s raw prompt and rewrite it into a detailed, vivid, and coherent description that maximizes visual quality, style consistency, and creativity. Preserve the original concept, but expand it with rich sensory details, precise artistic terms, and relevant keywords. Specify composition, lighting, perspective, colors, environment, style, and mood. Avoid unnecessary repetition. Do not add elements that contradict the original idea. Output only the final enhanced prompt.";
                    const composed = `${instruction}\n\nRaw prompt:\n"""\n${prompt}\n"""`;
                    const res = await fetch("/api/generate-text", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ prompt: composed }),
                    });
                    const json = await res.json();
                    const enhancedPrompt = sanitizeEnhancedPrompt(json?.text ?? "");
                    if (enhancedPrompt) {
                      setPrompt(enhancedPrompt);
                      update?.(id, { prompt: enhancedPrompt });
                    }
                  } finally {
                    setIsEnhancing(false);
                  }
                }}
              >
                {isEnhancing ? "…" : "✨"}
              </button>
              <div className="pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] text-foreground opacity-0 group-hover:opacity-100 transition-opacity font-semibold">Enhance Prompt</div>
            </div>
          </div>
        </div>
      )}
      <div className="px-3 py-2 border-b text-sm font-semibold">Image Generate</div>
      <div className="p-3 space-y-2">
        <label className="text-xs font-medium">Prompt {promptLocked ? <span className="text-[10px] ml-1 text-foreground/60">(from linked text)</span> : null}{promptLockedByModel ? <span className="text-[10px] ml-1 text-foreground/60">(disabled for this model)</span> : null}</label>
        <textarea
          value={prompt}
          onChange={(e) => {
            if (isPromptReadOnly) return;
            const v = e.target.value;
            setPrompt(v);
            update?.(id, { prompt: v });
          }}
          className="w-full h-20 p-2 text-sm rounded border bg-transparent nodrag"
          placeholder="Enter prompt"
          readOnly={isPromptReadOnly}
          draggable={false}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerMove={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onMouseMove={(e) => e.stopPropagation()}
          onMouseUp={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
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
            {isLoading ? "Generating..." : "Generate"}
          </button>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium">Result</label>
          <div className={`w-full bg-black/5 rounded overflow-hidden ${imgRatioApplied === "auto" ? "aspect-square" : ""}`} style={imgRatioApplied !== "auto" ? (() => {
            const p = parseAspect(imgRatioApplied);
            if (!p) return {} as React.CSSProperties;
            const [w, h] = p;
            return { aspectRatio: `${w} / ${h}` } as React.CSSProperties;
          })() : undefined}>
            <div className="grid place-items-center w-full h-full">
              {imageUrl ? (
                <img src={imageUrl} alt="result" className="object-cover w-full h-full" />
              ) : (
                <span className="text-xs text-foreground/60">
                  {isLoading ? "Generating image..." : "No image yet"}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
      {/* Visible plus handles */}
      <Handle type="target" position={Position.Left} className="!w-9 !h-9 !bg-background !border !border-foreground/30 !shadow absolute" style={{ left: -22, top: "50%", transform: "translate(-50%, -50%)" }} />
      <div className="pointer-events-none absolute text-foreground/80" style={{ left: -22, top: "50%", transform: "translate(-50%, -50%)" }}>+</div>
      <Handle type="source" position={Position.Right} className="!w-9 !h-9 !bg-background !border !border-foreground/30 !shadow absolute" style={{ right: -22, top: "50%", transform: "translate(50%, -50%)" }} />
      <div className="pointer-events-none absolute text-foreground/80" style={{ right: -22, top: "50%", transform: "translate(50%, -50%)" }}>+</div>
    </div>
  );
}