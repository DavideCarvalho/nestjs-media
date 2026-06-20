import { channel } from 'node:diagnostics_channel';

/** Standard ecosystem envelope: `nestjs:<lib>:<event>` channels carry this shape. */
export interface MediaDiagnosticEnvelope<P = unknown> {
  ts: number;
  lib: 'media';
  event: MediaDiagnosticEvent;
  payload: P;
}

/**
 * Every event the library publishes on a `nestjs:media:<event>` channel. Subscribe to
 * one (via `node:diagnostics_channel`) to run code on upload start/finish, attaches,
 * conversions, etc.; the [Telescope watcher](../../telescope) records them automatically.
 */
export type MediaDiagnosticEvent =
  // media-library (table model)
  | 'attach'
  | 'delete'
  | 'conversion'
  // resumable uploads (proxy path)
  | 'upload.start'
  | 'upload.progress'
  | 'upload.complete'
  | 'upload.abort'
  // attachments (column model)
  | 'attachment.create'
  | 'attachment.delete';

/** All media events, in a stable order — handy for wiring subscribers. */
export const MEDIA_DIAGNOSTIC_EVENTS: readonly MediaDiagnosticEvent[] = [
  'attach',
  'delete',
  'conversion',
  'upload.start',
  'upload.progress',
  'upload.complete',
  'upload.abort',
  'attachment.create',
  'attachment.delete',
];

// --- Typed payloads, one per event, so subscribers know the shape ---

export interface AttachPayload {
  id: string;
  ownerType: string;
  ownerId: string;
  collection: string;
  disk: string;
  path: string;
  size: number;
  mimeType: string;
}
export interface DeletePayload {
  id: string;
  ownerType: string;
  ownerId: string;
}
export interface ConversionPayload {
  id: string;
  conversion: string;
  path: string;
}
export interface UploadStartPayload {
  id: string;
  disk: string;
  key: string;
  size: number | undefined;
  contentType: string | undefined;
}
export interface UploadProgressPayload {
  id: string;
  offset: number;
  parts: number;
  size: number | undefined;
}
export interface UploadCompletePayload {
  id: string;
  disk: string;
  key: string;
  size: number;
}
export interface UploadAbortPayload {
  id: string;
}
export interface AttachmentCreatePayload {
  disk: string;
  path: string;
  size: number;
  mimeType: string;
  name: string;
  variants: string[];
}
export interface AttachmentDeletePayload {
  disk: string;
  path: string;
  variants: string[];
}

/** Maps each event to its payload type, so `publishMedia` is checked at the call site. */
export interface MediaDiagnosticPayloads {
  attach: AttachPayload;
  delete: DeletePayload;
  conversion: ConversionPayload;
  'upload.start': UploadStartPayload;
  'upload.progress': UploadProgressPayload;
  'upload.complete': UploadCompletePayload;
  'upload.abort': UploadAbortPayload;
  'attachment.create': AttachmentCreatePayload;
  'attachment.delete': AttachmentDeletePayload;
}

/** Publish a media event to its diagnostics channel (no-op when nobody is subscribed). */
export function publishMedia<E extends MediaDiagnosticEvent>(
  event: E,
  payload: MediaDiagnosticPayloads[E],
): void {
  const ch = channel(`nestjs:media:${event}`);
  if (ch.hasSubscribers) {
    ch.publish({ ts: Date.now(), lib: 'media', event, payload } satisfies MediaDiagnosticEnvelope);
  }
}
