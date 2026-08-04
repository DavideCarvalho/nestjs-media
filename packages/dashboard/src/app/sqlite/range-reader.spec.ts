import { describe, expect, it, vi } from 'vitest';
import { RangeReader } from './range-reader.js';
import type { RangeTransport } from './range-transport.js';

/** A fake object store: byte at offset i is `i % 251`, so any slice is verifiable by arithmetic. */
function sourceByte(offset: number): number {
  return offset % 251;
}

interface Recorded {
  transport: RangeTransport;
  calls: Array<[number, number]>;
}

function recordingTransport(size: number): Recorded {
  const calls: Array<[number, number]> = [];
  const transport: RangeTransport = (start, endInclusive) => {
    calls.push([start, endInclusive]);
    const end = Math.min(endInclusive, size - 1);
    const bytes = new Uint8Array(Math.max(0, end - start + 1));
    for (let i = 0; i < bytes.length; i++) bytes[i] = sourceByte(start + i);
    return bytes;
  };
  return { transport, calls };
}

describe('RangeReader', () => {
  it('widens a small read to one aligned chunk', () => {
    const { transport, calls } = recordingTransport(1000);
    const reader = new RangeReader({ size: 1000, fetchRange: transport, chunkBytes: 64 });

    const { bytes, got } = reader.read(100, 10);

    expect(calls).toEqual([[64, 127]]);
    expect(got).toBe(10);
    expect([...bytes]).toEqual([100, 101, 102, 103, 104, 105, 106, 107, 108, 109]);
  });

  it('coalesces a run of missing chunks into a single request', () => {
    const { transport, calls } = recordingTransport(10_000);
    const reader = new RangeReader({ size: 10_000, fetchRange: transport, chunkBytes: 64 });

    reader.read(0, 500);

    expect(calls).toEqual([[0, 511]]);
  });

  it('does not re-request a chunk it already holds', () => {
    const { transport, calls } = recordingTransport(1000);
    const reader = new RangeReader({ size: 1000, fetchRange: transport, chunkBytes: 64 });

    reader.read(64, 8);
    reader.read(100, 8);
    reader.read(127, 1);

    expect(calls).toEqual([[64, 127]]);
    expect(reader.bytesFetched).toBe(64);
  });

  it('fetches only the chunks a scattered read is missing', () => {
    const { transport, calls } = recordingTransport(10_000);
    const reader = new RangeReader({ size: 10_000, fetchRange: transport, chunkBytes: 64 });

    reader.read(0, 1); // chunk 0
    reader.read(192, 1); // chunk 3
    reader.read(0, 256); // chunks 0-3, of which only 1 and 2 are missing

    expect(calls).toEqual([
      [0, 63],
      [192, 255],
      [64, 191],
    ]);
  });

  it('clips the last chunk to the file size instead of asking past the end', () => {
    const { transport, calls } = recordingTransport(100);
    const reader = new RangeReader({ size: 100, fetchRange: transport, chunkBytes: 64 });

    const { got } = reader.read(64, 64);

    expect(calls).toEqual([[64, 99]]);
    expect(got).toBe(36);
  });

  it('zero-fills a read that runs past the end and reports the short count', () => {
    const { transport } = recordingTransport(70);
    const reader = new RangeReader({ size: 70, fetchRange: transport, chunkBytes: 64 });

    const { bytes, got } = reader.read(66, 8);

    expect(got).toBe(4);
    expect(bytes.length).toBe(8);
    expect([...bytes]).toEqual([66, 67, 68, 69, 0, 0, 0, 0]);
  });

  it('returns nothing, and asks for nothing, when the read starts past the end', () => {
    const { transport, calls } = recordingTransport(70);
    const reader = new RangeReader({ size: 70, fetchRange: transport, chunkBytes: 64 });

    const { bytes, got } = reader.read(200, 16);

    expect(got).toBe(0);
    expect(bytes.every((byte) => byte === 0)).toBe(true);
    expect(calls).toEqual([]);
  });

  it('counts every byte that crossed the wire, and only those', () => {
    const { transport } = recordingTransport(10_000);
    const reader = new RangeReader({ size: 10_000, fetchRange: transport, chunkBytes: 64 });

    reader.read(0, 4);
    expect(reader.bytesFetched).toBe(64);
    reader.read(0, 200);
    expect(reader.bytesFetched).toBe(256);
    reader.read(10, 20);
    expect(reader.bytesFetched).toBe(256);
  });

  it('evicts least-recently-used chunks to stay inside its bound', () => {
    const { transport, calls } = recordingTransport(10_000);
    const reader = new RangeReader({
      size: 10_000,
      fetchRange: transport,
      chunkBytes: 64,
      maxCachedChunks: 2,
    });

    reader.read(0, 1); // chunk 0
    reader.read(64, 1); // chunk 1
    reader.read(0, 1); // chunk 0 again — now the most recent, so chunk 1 is next to go
    reader.read(128, 1); // chunk 2 evicts chunk 1
    expect(reader.cachedChunkCount).toBe(2);

    calls.length = 0;
    reader.read(0, 1);
    expect(calls).toEqual([]); // chunk 0 survived
    reader.read(64, 1);
    expect(calls).toEqual([[64, 127]]); // chunk 1 had to come back
  });

  it('reads correct bytes across a chunk boundary', () => {
    const { transport } = recordingTransport(10_000);
    const reader = new RangeReader({ size: 10_000, fetchRange: transport, chunkBytes: 64 });

    const { bytes, got } = reader.read(60, 8);

    expect(got).toBe(8);
    expect([...bytes]).toEqual([60, 61, 62, 63, 64, 65, 66, 67]);
  });

  it('propagates a transport failure rather than serving zeroes', () => {
    const boom: RangeTransport = () => {
      throw new Error('HTTP 403');
    };
    const reader = new RangeReader({ size: 1000, fetchRange: boom, chunkBytes: 64 });

    expect(() => reader.read(0, 10)).toThrow('HTTP 403');
  });

  it('rejects an empty body instead of treating it as a hole', () => {
    const empty: RangeTransport = vi.fn(() => new Uint8Array(0));
    const reader = new RangeReader({ size: 1000, fetchRange: empty, chunkBytes: 64 });

    expect(() => reader.read(0, 10)).toThrow(/came back empty/);
  });
});
