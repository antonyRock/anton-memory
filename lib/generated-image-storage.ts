import "server-only";

import {
  mergeDocumentMetadata,
  type StoredDocument,
  uploadDocumentBytes
} from "@/lib/documents";
import { createImageThumbnailBase64 } from "@/lib/image-thumbnail";
import { getSupabase } from "@/lib/supabase";

const MAX_GENERATED_IMAGE_INLINE_BYTES = 3 * 1024 * 1024;

function canStoreGeneratedImageInline(bytes: Buffer) {
  return bytes.length <= MAX_GENERATED_IMAGE_INLINE_BYTES;
}

function randomId() {
  return Math.random().toString(36).slice(2, 10);
}

async function readDocumentMetadata(documentId: string | number) {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("documents")
    .select("metadata")
    .eq("id", documentId)
    .maybeSingle();
  return data?.metadata;
}

async function updateDocumentMetadata(
  documentId: string | number,
  patch: Record<string, unknown>,
  extra: Record<string, unknown> = {}
) {
  const supabase = getSupabase();
  await supabase
    .from("documents")
    .update({
      ...extra,
      metadata: mergeDocumentMetadata(await readDocumentMetadata(documentId), patch)
    })
    .eq("id", documentId);
}

export async function createGeneratedImageDocument(input: {
  prompt: string;
  imageBytes: Buffer;
  sourceDocumentIds?: Array<string | number>;
}) {
  const thumbnail = await createImageThumbnailBase64(input.imageBytes);
  const metadata: Record<string, unknown> = {
    kind: "generated_image",
    prompt: input.prompt,
    source_document_ids: input.sourceDocumentIds ?? [],
    image_pending_full: true,
    ...(thumbnail
      ? {
          preview_thumbnail_base64: thumbnail.base64,
          preview_thumbnail_type: thumbnail.mimeType
        }
      : {})
  };

  const summary = `Generated image for prompt: ${input.prompt.slice(0, 500)}`;
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("documents")
    .insert({
      file_name: `generated-${Date.now()}.png`,
      file_type: "image/png",
      file_size: input.imageBytes.length,
      storage_path: null,
      extracted_text: summary,
      summary,
      metadata
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Could not save generated image metadata: ${error.message}`);
  }

  const document = data as StoredDocument;
  const previewDataUrl = thumbnail
    ? `data:${thumbnail.mimeType};base64,${thumbnail.base64}`
    : null;

  return { document, previewDataUrl };
}

export async function persistGeneratedImageBytes(input: {
  documentId: string | number;
  imageBytes: Buffer;
}) {
  const storagePath = `generated/${Date.now()}-${randomId()}.png`;

  try {
    await uploadDocumentBytes(storagePath, input.imageBytes, "image/png", {
      timeoutMs: 120_000,
      attempts: 5
    });

    await updateDocumentMetadata(
      input.documentId,
      {
        image_pending_full: false,
        storage_fallback: "cloud"
      },
      { storage_path: storagePath }
    );
    return;
  } catch (storageError) {
    console.error("Generated image storage upload failed:", storageError);
  }

  if (canStoreGeneratedImageInline(input.imageBytes)) {
    await updateDocumentMetadata(
      input.documentId,
      {
        inline_base64: input.imageBytes.toString("base64"),
        storage_fallback: "inline",
        image_pending_full: false
      },
      { storage_path: null }
    );
    return;
  }

  await updateDocumentMetadata(input.documentId, {
    image_pending_full: false,
    storage_fallback: "thumbnail_only"
  });
}
