/**
 * Host-supplied context about a disk object, shown in the console's preview.
 *
 * The console can describe a file only as storage sees it: key, size, content type, last modified.
 * Everything that makes the file *mean* something lives in the host — which work order this scan
 * belongs to, which knowledge base indexed it, whether processing has run. An admin looking at
 * `rag/019af.../handbook.pdf` in the object browser has no way to learn any of that without leaving
 * for another screen and searching by key.
 *
 * This is the seam for handing that back. The host registers a provider; the console asks it when an
 * object is previewed and renders whatever comes back.
 *
 * **Data, not components — and not by preference.** The console ships as a prebuilt SPA bundle, so a
 * host has no way to inject React into it. A provider therefore returns a small structured value the
 * console knows how to render (facts, links, a note), rather than something it draws itself. The
 * cost is a fixed vocabulary; the benefit is that this works at all for a published bundle, and that
 * the console stays ignorant of every domain plugged into it.
 */

import type { ObjectInsight, ObjectInsightsResponse } from '../client/types.js';

export type {
  ObjectInsight,
  ObjectInsightFact,
  ObjectInsightLink,
  ObjectInsightsResponse,
} from '../client/types.js';

/** Which object is being described. */
export interface ObjectInsightContext {
  disk: string;
  key: string;
}

/**
 * A source of {@link ObjectInsight}s, registered by the host on `MediaDashboardModule.forRoot`.
 *
 * `resolve` runs on every preview of every object, so it must be cheap — one indexed lookup, not a
 * scan. Return `null` for an object this provider has nothing to say about (the overwhelmingly
 * common case: most providers care about one key prefix), and the console renders nothing for it.
 *
 * A provider that throws is **skipped**, logged, and the preview renders without it. Annotation is
 * never worth taking the preview down for — a host lookup failing must not stop an admin from
 * opening a file.
 */
export interface ObjectInsightProvider {
  /** Stable identifier, used in the log line when this provider fails. */
  id: string;
  resolve(ctx: ObjectInsightContext): Promise<ObjectInsight | null> | ObjectInsight | null;
}

/** Schemes an {@link ObjectInsightLink} may point at. Anything else is dropped, not rendered. */
const SAFE_LINK_SCHEMES = new Set(['http:', 'https:']);

/**
 * Drop links the console must not render.
 *
 * A relative href (`/ctrl/rag/...`) is the normal case and always allowed — it can only ever address
 * the host's own app. An absolute one is parsed and kept only if it is http(s), which refuses
 * `javascript:` and `data:` hrefs. Providers are host code, so this is not a trust boundary so much
 * as a guard against a provider interpolating user-controlled text into a URL and handing the
 * console something that executes when clicked.
 */
export function sanitizeInsight(insight: ObjectInsight): ObjectInsight {
  if (insight.links === undefined) {
    return insight;
  }
  const links = insight.links.filter((link) => {
    if (link.href.startsWith('/')) {
      // `//evil.com` is protocol-relative — an absolute URL wearing a relative one's clothes.
      return !link.href.startsWith('//');
    }
    try {
      return SAFE_LINK_SCHEMES.has(new URL(link.href).protocol);
    } catch {
      return false;
    }
  });
  return { ...insight, links };
}
