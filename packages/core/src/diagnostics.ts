import { channel } from 'node:diagnostics_channel';

/** Standard ecosystem envelope: `nestjs:<lib>:<event>` channels carry this shape. */
export interface MediaDiagnosticEnvelope<P = unknown> {
  ts: number;
  lib: 'media';
  event: string;
  payload: P;
}

export type MediaDiagnosticEvent = 'attach' | 'delete' | 'conversion';

/** Publish a media event to its diagnostics channel (no-op when nobody is subscribed). */
export function publishMedia(event: MediaDiagnosticEvent, payload: unknown): void {
  const ch = channel(`nestjs:media:${event}`);
  if (ch.hasSubscribers) {
    ch.publish({ ts: Date.now(), lib: 'media', event, payload } satisfies MediaDiagnosticEnvelope);
  }
}
