import { describe, expect, it } from 'vitest';
import { type SyncXhr, createSyncRangeTransport, rangeHeaderValue } from './range-transport.js';

interface StubOptions {
  status: number;
  response?: unknown;
}

interface Stub extends SyncXhr {
  readonly opened: Array<[string, string, boolean]>;
  readonly headers: Record<string, string>;
  readonly sent: number;
}

/** Stands in for XMLHttpRequest: jsdom refuses a synchronous request with a responseType, so a real
 *  one could never reach the branches these tests are about. */
function stubXhr(options: StubOptions): Stub {
  const opened: Array<[string, string, boolean]> = [];
  const headers: Record<string, string> = {};
  let sent = 0;
  return {
    opened,
    headers,
    get sent() {
      return sent;
    },
    responseType: '',
    status: options.status,
    response: options.response ?? new ArrayBuffer(0),
    open(method, url, async) {
      opened.push([method, url, async]);
    },
    setRequestHeader(name, value) {
      headers[name] = value;
    },
    send() {
      sent++;
    },
  };
}

describe('rangeHeaderValue', () => {
  it('is inclusive on both ends', () => {
    expect(rangeHeaderValue(0, 65_535)).toBe('bytes=0-65535');
    expect(rangeHeaderValue(65_536, 131_071)).toBe('bytes=65536-131071');
  });

  it('names a single byte as a range of one', () => {
    expect(rangeHeaderValue(7, 7)).toBe('bytes=7-7');
  });
});

describe('createSyncRangeTransport', () => {
  it('sends a synchronous, arraybuffer, Range-bearing GET', () => {
    const bytes = Uint8Array.from([1, 2, 3, 4]);
    const xhr = stubXhr({ status: 206, response: bytes.buffer });
    const transport = createSyncRangeTransport('/media/api/objects/db.sqlite', () => xhr);

    const result = transport(0, 3);

    expect(xhr.opened).toEqual([['GET', '/media/api/objects/db.sqlite', false]]);
    expect(xhr.responseType).toBe('arraybuffer');
    expect(xhr.headers.Range).toBe('bytes=0-3');
    expect(xhr.sent).toBe(1);
    expect([...result]).toEqual([1, 2, 3, 4]);
  });

  it('refuses a 200 and says the Range header was dropped', () => {
    const xhr = stubXhr({ status: 200, response: new ArrayBuffer(302_000_000) });
    const transport = createSyncRangeTransport('/db.sqlite', () => xhr);

    expect(() => transport(0, 65_535)).toThrow(/HTTP 200 \(whole object\) instead of 206/);
    expect(() => transport(0, 65_535)).toThrow(/dropped the Range header/);
  });

  it('reports any other status with its code', () => {
    const transport = createSyncRangeTransport('/db.sqlite', () => stubXhr({ status: 403 }));

    expect(() => transport(0, 15)).toThrow('Range request "bytes=0-15" failed with HTTP 403.');
  });

  it('refuses a body that is not an ArrayBuffer', () => {
    const xhr = stubXhr({ status: 206, response: '<html>nope</html>' });
    const transport = createSyncRangeTransport('/db.sqlite', () => xhr);

    expect(() => transport(0, 15)).toThrow(/returned a string body/);
  });
});
