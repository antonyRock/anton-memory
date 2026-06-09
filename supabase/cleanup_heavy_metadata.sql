-- One-time cleanup for oversized image payloads stored in message/document metadata.
-- Run in Supabase SQL editor if chats with generated images load slowly or fail to open.

update public.messages
set metadata = metadata
  - 'chat_image_preview'
  - 'preview_image_base64'
where metadata ?| array['chat_image_preview', 'preview_image_base64'];

update public.documents
set metadata = metadata
  - 'inline_base64'
  - 'preview_thumbnail_base64'
where metadata ?| array['inline_base64', 'preview_thumbnail_base64'];
