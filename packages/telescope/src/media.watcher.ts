import { subscribe, unsubscribe } from 'node:diagnostics_channel';
import {
  MEDIA_DIAGNOSTIC_EVENTS,
  type MediaDiagnosticEnvelope,
  type MediaDiagnosticEvent,
} from '@dudousxd/nestjs-media-core';
import type { Watcher, WatcherContext } from '@dudousxd/nestjs-telescope';

// Record every milestone, but not per-chunk `upload.progress` — that would flood the
// timeline. Progress stays available on its channel for programmatic subscribers.
const EVENTS: MediaDiagnosticEvent[] = MEDIA_DIAGNOSTIC_EVENTS.filter(
  (e) => e !== 'upload.progress',
);

/**
 * Telescope watcher that records a `media` entry for every milestone
 * `nestjs:media:*` diagnostics event the library emits — zero coupling: media
 * publishes, this subscribes. Register it with the telescope module's watcher list.
 */
export class MediaWatcher implements Watcher {
  readonly type = 'media';
  private readonly disposers: Array<() => void> = [];

  register(ctx: WatcherContext): void {
    for (const event of EVENTS) {
      const channel = `nestjs:media:${event}`;
      const onMessage = (message: unknown) => {
        const envelope = message as MediaDiagnosticEnvelope<Record<string, unknown>>;
        ctx.record({
          type: this.type,
          content: { event: envelope.event, ...envelope.payload },
        });
      };
      subscribe(channel, onMessage);
      this.disposers.push(() => unsubscribe(channel, onMessage));
    }
  }

  /** Detach all channel subscriptions (e.g. on module destroy). */
  dispose(): void {
    while (this.disposers.length) this.disposers.pop()?.();
  }
}
