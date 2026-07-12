import { subscribe, unsubscribe } from 'node:diagnostics_channel';
import { channelName, claimDiagnostics } from '@dudousxd/nestjs-diagnostics';
import type { DiagnosticEvent } from '@dudousxd/nestjs-diagnostics';
import { MEDIA_DIAGNOSTIC_EVENTS, type MediaDiagnosticEvent } from '@dudousxd/nestjs-media-core';
import type { Watcher, WatcherContext } from '@dudousxd/nestjs-telescope';

// Record every milestone, but not per-chunk `upload.progress` — that would flood the
// timeline. Progress stays available on its channel for programmatic subscribers.
const EVENTS: MediaDiagnosticEvent[] = MEDIA_DIAGNOSTIC_EVENTS.filter(
  (e) => e !== 'upload.progress',
);

/**
 * Telescope watcher that records a `media` entry for every milestone
 * `aviary:media:*` diagnostics event the library emits — zero coupling: media
 * publishes via `@dudousxd/nestjs-diagnostics`, this subscribes.
 *
 * **Superseded by `@dudousxd/nestjs-diagnostics-telescope`'s generic watcher,**
 * which auto-captures every `aviary:media:*` channel registered in the diagnostics
 * registry — prefer that when the generic bridge is already in use. This watcher is
 * kept for standalone use without the diagnostics telescope bridge.
 *
 * Since diagnostics 0.7, double-recording when both watchers run is handled
 * automatically: `register()` claims every event in {@link EVENTS} via
 * `claimDiagnostics('media', ...)`, so the generic bridge's `DiagnosticWatcher`
 * skips them at record time and no exclude list needs hand-maintaining. The
 * `mediaDiagnosticKey`/`exclude` advice on the generic bridge still applies to
 * mute events nobody records at all, e.g. `mediaDiagnosticKey('upload.progress')`.
 *
 * Register it with the telescope module's watcher list.
 */
export class MediaWatcher implements Watcher {
  readonly type = 'media';
  private readonly disposers: Array<() => void> = [];

  register(ctx: WatcherContext): void {
    this.disposers.push(claimDiagnostics('media', EVENTS));
    for (const event of EVENTS) {
      const channel = channelName('media', event);
      const onMessage = (message: unknown) => {
        const envelope = message as DiagnosticEvent<Record<string, unknown>>;
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
