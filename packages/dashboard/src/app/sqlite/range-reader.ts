import type { RangeTransport } from './range-transport.js';

/**
 * A read-only window onto a remote file, addressed the way SQLite addresses one: arbitrary
 * (offset, length) reads, mostly 4 KB pages, in an order nobody can predict.
 *
 * Serving each of those as its own HTTP request would be ruinous — a `SELECT … LIMIT 200` touches
 * the schema, a b-tree root, some interior pages and a run of leaves, and every one of them would
 * be a round-trip. So reads are widened to aligned chunks and kept in a bounded LRU: 64 KB spreads
 * one round-trip over sixteen consecutive pages, which is roughly how a table scan reads anyway,
 * while staying small enough that the schema lookup at open costs kilobytes and not megabytes.
 */

/** 64 KB. Sixteen 4 KB pages per round-trip — enough to amortize latency, small enough to waste little. */
export const DEFAULT_CHUNK_BYTES = 64 * 1024;

/** 256 chunks ≈ 16 MB at the default chunk size: a working set, not a download. */
export const DEFAULT_MAX_CACHED_CHUNKS = 256;

export interface RangeReaderOptions {
  /** Total byte size of the remote object, already known by the caller. */
  size: number;
  fetchRange: RangeTransport;
  chunkBytes?: number;
  maxCachedChunks?: number;
}

export interface RangeReadResult {
  /** Always exactly `length` bytes; anything not covered by the file is left zeroed. */
  bytes: Uint8Array;
  /** How many leading bytes are real. `got < length` is SQLite's short-read case. */
  got: number;
}

export class RangeReader {
  readonly size: number;
  readonly chunkBytes: number;

  readonly #fetchRange: RangeTransport;
  readonly #maxCachedChunks: number;
  /** Chunk index → bytes. Insertion order is the LRU order; a hit re-inserts to move to the back. */
  readonly #chunks = new Map<number, Uint8Array>();
  #bytesFetched = 0;

  constructor(options: RangeReaderOptions) {
    const chunkBytes = options.chunkBytes ?? DEFAULT_CHUNK_BYTES;
    if (!Number.isInteger(chunkBytes) || chunkBytes <= 0) {
      throw new RangeError(`chunkBytes must be a positive integer, got ${chunkBytes}`);
    }
    if (!Number.isInteger(options.size) || options.size < 0) {
      throw new RangeError(`size must be a non-negative integer, got ${options.size}`);
    }
    this.size = options.size;
    this.chunkBytes = chunkBytes;
    this.#fetchRange = options.fetchRange;
    this.#maxCachedChunks = Math.max(1, options.maxCachedChunks ?? DEFAULT_MAX_CACHED_CHUNKS);
  }

  /** Bytes actually pulled over the wire since this reader was created. Never decreases. */
  get bytesFetched(): number {
    return this.#bytesFetched;
  }

  /** Chunks currently resident. Exposed for tests asserting the cache stays bounded. */
  get cachedChunkCount(): number {
    return this.#chunks.size;
  }

  /**
   * Reads `length` bytes at `offset`, fetching whatever chunks are missing.
   *
   * Reads that run past the end of the file are not an error — SQLite does this routinely and
   * expects the tail zero-filled and a short-read signal, which is what `got` carries.
   */
  read(offset: number, length: number): RangeReadResult {
    if (!Number.isInteger(offset) || offset < 0) {
      throw new RangeError(`read offset must be a non-negative integer, got ${offset}`);
    }
    if (!Number.isInteger(length) || length < 0) {
      throw new RangeError(`read length must be a non-negative integer, got ${length}`);
    }

    const bytes = new Uint8Array(length);
    const available = Math.max(0, Math.min(length, this.size - offset));
    if (available === 0) return { bytes, got: 0 };

    const firstChunk = Math.floor(offset / this.chunkBytes);
    const lastChunk = Math.floor((offset + available - 1) / this.chunkBytes);
    this.#ensureCached(firstChunk, lastChunk);

    let covered = 0;
    for (let index = firstChunk; index <= lastChunk; index++) {
      const data = this.#take(index);
      if (!data) break;
      const chunkStart = index * this.chunkBytes;
      const from = Math.max(offset, chunkStart);
      const to = Math.min(offset + available, chunkStart + data.length);
      // A gap means the server returned a short body for some chunk in the middle of the run.
      // Stop counting coverage there rather than reporting bytes we never received.
      if (to <= from || from - offset !== covered) break;
      bytes.set(data.subarray(from - chunkStart, to - chunkStart), from - offset);
      covered = to - offset;
    }
    return { bytes, got: covered };
  }

  /**
   * Makes sure every chunk in `[firstChunk, lastChunk]` is resident, coalescing each unbroken run
   * of missing chunks into a single request. Without the coalescing, a sequential scan across an
   * evicted region would issue one request per chunk where one request would do.
   */
  #ensureCached(firstChunk: number, lastChunk: number): void {
    let index = firstChunk;
    while (index <= lastChunk) {
      if (this.#chunks.has(index)) {
        index++;
        continue;
      }
      let runEnd = index;
      while (runEnd < lastChunk && !this.#chunks.has(runEnd + 1)) runEnd++;
      this.#fetchRun(index, runEnd);
      index = runEnd + 1;
    }
  }

  #fetchRun(firstChunk: number, lastChunk: number): void {
    const start = firstChunk * this.chunkBytes;
    const endExclusive = Math.min((lastChunk + 1) * this.chunkBytes, this.size);
    const data = this.#fetchRange(start, endExclusive - 1);
    if (data.length === 0) {
      throw new Error(`Byte range ${start}-${endExclusive - 1} came back empty.`);
    }
    this.#bytesFetched += data.length;

    for (let index = firstChunk; index <= lastChunk; index++) {
      const from = index * this.chunkBytes - start;
      if (from >= data.length) break;
      const to = Math.min(from + this.chunkBytes, data.length);
      // `slice`, not `subarray`: a view would pin the whole multi-chunk response in memory for as
      // long as any one of its chunks stays cached, which quietly defeats the eviction bound.
      this.#store(index, data.slice(from, to));
    }
  }

  #store(index: number, data: Uint8Array): void {
    this.#chunks.set(index, data);
    while (this.#chunks.size > this.#maxCachedChunks) {
      const oldest = this.#chunks.keys().next();
      if (oldest.done) break;
      this.#chunks.delete(oldest.value);
    }
  }

  /** Reads a chunk and marks it most-recently-used. */
  #take(index: number): Uint8Array | undefined {
    const data = this.#chunks.get(index);
    if (!data) return undefined;
    this.#chunks.delete(index);
    this.#chunks.set(index, data);
    return data;
  }
}
