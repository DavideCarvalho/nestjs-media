/**
 * The one synchronous byte-range read the whole feature rests on.
 *
 * SQLite's `xRead` is synchronous C — it has to return the bytes, it cannot await them. The escape
 * hatch that does not require the *host* application to serve COOP/COEP headers (a non-starter for
 * a library that gets mounted into someone else's NestJS app) is a synchronous `XMLHttpRequest`.
 * Sync XHR is forbidden on the main thread but permitted in a Worker, and only in a Worker may it
 * carry `responseType = 'arraybuffer'`. That is why the engine lives in a Worker at all, and it is
 * why there is no `fetch()` anywhere in this file.
 */

/** Fetches `[start, endInclusive]` and returns exactly the bytes the server sent. Throws on error. */
export type RangeTransport = (start: number, endInclusive: number) => Uint8Array;

/**
 * The slice of `XMLHttpRequest` a range read touches. Declared structurally rather than taken from
 * the DOM lib so the guards below can be exercised under vitest's node environment with a stub —
 * jsdom refuses synchronous `responseType`, so a real XHR could never run these paths in a test.
 */
export interface SyncXhr {
  open(method: string, url: string, async: boolean): void;
  setRequestHeader(name: string, value: string): void;
  send(): void;
  responseType: XMLHttpRequestResponseType;
  readonly status: number;
  readonly response: unknown;
}

/** Formats an HTTP `Range` value. Inclusive on both ends, per RFC 9110. */
export function rangeHeaderValue(start: number, endInclusive: number): string {
  return `bytes=${start}-${endInclusive}`;
}

/**
 * Binds a URL to a synchronous range transport.
 *
 * `createXhr` exists purely so tests can supply a stub; production always gets a real
 * `XMLHttpRequest` from the worker global scope.
 */
export function createSyncRangeTransport(
  url: string,
  createXhr: () => SyncXhr = () => new XMLHttpRequest(),
): RangeTransport {
  return (start, endInclusive) => {
    const range = rangeHeaderValue(start, endInclusive);
    const xhr = createXhr();
    xhr.open('GET', url, false);
    xhr.responseType = 'arraybuffer';
    xhr.setRequestHeader('Range', range);
    xhr.send();

    if (xhr.status === 200) {
      // A 200 means someone between here and the object store — a proxy, a CDN, a signed-URL
      // redirect, a disk driver that ignores Range — answered with the *whole* object. Handing
      // those bytes back would let SQLite parse the head of a 302 MB body as if it were a 64 KB
      // page window, producing corruption errors that point nowhere near the real cause. Fail loud.
      throw new Error(
        [
          `Range request "${range}" was answered with HTTP 200 (whole object) instead of 206.`,
          'Something between the browser and the storage backend dropped the Range header,',
          'so the database cannot be read without downloading it in full.',
        ].join(' '),
      );
    }
    if (xhr.status !== 206) {
      throw new Error(`Range request "${range}" failed with HTTP ${xhr.status}.`);
    }

    const body = xhr.response;
    if (!(body instanceof ArrayBuffer)) {
      throw new Error(
        `Range request "${range}" returned a ${typeof body} body; expected an ArrayBuffer.`,
      );
    }
    return new Uint8Array(body);
  };
}
