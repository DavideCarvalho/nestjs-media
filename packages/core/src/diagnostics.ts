import { emit } from '@dudousxd/nestjs-diagnostics';

/**
 * Standard ecosystem envelope shape for media diagnostics. Events now flow on
 * `aviary:media:*` channels via `@dudousxd/nestjs-diagnostics` — the canonical
 * envelope is {@link import('@dudousxd/nestjs-diagnostics').DiagnosticEvent}, and
 * the generic telescope bridge auto-captures every `aviary:media:*` event without
 * any per-event wiring.
 *
 * This type is kept for backwards-compatibility with any code that types a received
 * message as `MediaDiagnosticEnvelope`; prefer `DiagnosticEvent` for new observers.
 */
export interface MediaDiagnosticEnvelope<P = unknown> {
  ts: number;
  lib: 'media';
  event: MediaDiagnosticEvent;
  payload: P;
}

/**
 * Every event the library publishes on an `aviary:media:<event>` channel. Subscribe
 * to one (via `node:diagnostics_channel` + `channelName('media', event)` from
 * `@dudousxd/nestjs-diagnostics`) to run code on upload start/finish, attaches,
 * conversions, etc.; the [Telescope watcher](../../telescope) records them
 * automatically.
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

/**
 * The telescope key for a media diagnostics channel — `media:<event>`. This is
 * the key the `@dudousxd/nestjs-diagnostics-telescope` bridge matches its
 * `exclude` option against, and the label its "Busiest events" panel shows.
 * Distinct from the `aviary:media:<event>` channel name used on the wire.
 */
export type MediaDiagnosticKey = `media:${MediaDiagnosticEvent}`;

/**
 * Compose the telescope key for a media event, typed against {@link
 * MediaDiagnosticEvent} so a misspelled event is a compile error. Since the
 * library owns the `media` lib name, it owns the composed key too — feed the
 * result to `nestjsDiagnosticsTelescope({ exclude: [...] })` to mute a noisy
 * channel, e.g. `mediaDiagnosticKey('upload.progress')`.
 */
export function mediaDiagnosticKey(event: MediaDiagnosticEvent): MediaDiagnosticKey {
  return `media:${event}`;
}

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
  /** Opaque application data supplied at createUpload. See `UploadSession.metadata`. */
  metadata?: Record<string, unknown>;
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
  /**
   * Opaque application data supplied at createUpload. Subscribing to `upload.complete` and reading
   * this is what lets a host act on a finished upload (index it, attach it, kick off a workflow)
   * without a client round-trip after the bytes land — so an abandoned client can't leave the object
   * orphaned. See `UploadSession.metadata`.
   */
  metadata?: Record<string, unknown>;
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

/**
 * Publish a media event via `@dudousxd/nestjs-diagnostics` on
 * `aviary:media:<event>` (no-op when nobody is subscribed). The generic telescope
 * bridge auto-subscribes to every registered `aviary:*` channel, so media events
 * are captured without any per-event wiring.
 */
export function publishMedia<E extends MediaDiagnosticEvent>(
  event: E,
  payload: MediaDiagnosticPayloads[E],
): void {
  emit('media', event, payload);
}
