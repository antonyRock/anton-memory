import "server-only";

import { Jimp } from "jimp";

export type ImageThumbnail = {
  base64: string;
  mimeType: string;
};

export async function createImageThumbnailBase64(
  bytes: Buffer,
  maxSize = 320
): Promise<ImageThumbnail | null> {
  try {
    const image = await Jimp.read(bytes);
    image.scaleToFit({ w: maxSize, h: maxSize });
    const buffer = await image.getBuffer("image/jpeg", { quality: 82 });
    return {
      base64: buffer.toString("base64"),
      mimeType: "image/jpeg"
    };
  } catch (error) {
    console.error("Thumbnail generation failed:", error);
    return null;
  }
}
