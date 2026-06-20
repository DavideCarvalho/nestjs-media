import { Attachment, type AttachmentData } from '@dudousxd/nestjs-media-core';

// Prisma has no entity classes, so there's no decorator — store an Attachment in a
// `Json` column and (de)serialize with these helpers.

/** Serialize an Attachment for a Prisma `Json` column (null-safe). */
export function toAttachmentJson(value: Attachment | null | undefined): AttachmentData | null {
  return value ? value.toJSON() : null;
}

/** Rehydrate an Attachment from a Prisma `Json` column value (null-safe). */
export function fromAttachmentJson(value: unknown): Attachment | null {
  return Attachment.fromJSON((value as AttachmentData | null | undefined) ?? null);
}
