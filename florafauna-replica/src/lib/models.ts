export const textModels = [
  "gpt-4o-mini",
  "gpt-4o",
  "gpt-4.1-mini",
] as const;

export const imageModels = [
  "gpt-image-1",
] as const;

export const videoModels = [
  "gpt-video-1",
] as const;

export type TextModel = typeof textModels[number];
export type ImageModel = typeof imageModels[number];
export type VideoModel = typeof videoModels[number];