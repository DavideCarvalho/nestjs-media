import type { Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import type { RangeReader } from './range-reader.js';

/**
 * A read-only `sqlite3_vfs` whose backing store is an HTTP server that honors byte ranges.
 *
 * Read-only here is *structural*, not a policy check: there is no code path in this file that can
 * produce a byte on the far end. `xWrite`, `xTruncate` and `xDelete` return `SQLITE_READONLY`, and
 * `xOpen` refuses any flag combination asking for creation or write access. A caller who manages to
 * get a write past the SQL layer still cannot mutate the object in storage.
 *
 * Everything registered here goes through a registry keyed by path, so `xAccess`/`xOpen` answer for
 * unknown paths locally, without a request. That is the second line of defence behind `immutable=1`
 * against sidecar probes (`-wal`, `-shm`, `-journal`) that would otherwise be 404s on every open.
 */

export const RANGE_VFS_NAME = 'media-http-range';

/** SQLite's own default page size, and the natural sector size for a file we only ever read. */
const SECTOR_SIZE = 4096;

/** Longer than any path `rangeDbFile()` mints, with room for SQLite's sidecar suffixes. */
const MAX_PATHNAME = 512;

export interface RangeVfsRegistry {
  /** Makes `path` openable through this VFS, backed by `reader`. */
  register(path: string, reader: RangeReader): void;
  unregister(path: string): void;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Registers the VFS with the given sqlite3 instance and returns its path registry. Call once per
 * wasm instance — a second call would collide on the VFS name.
 */
export function installRangeVfs(sqlite3: Sqlite3Static): RangeVfsRegistry {
  const { capi, wasm } = sqlite3;

  if (capi.sqlite3_vfs_find(RANGE_VFS_NAME)) {
    throw new Error(`A VFS named "${RANGE_VFS_NAME}" is already registered.`);
  }

  /** Path → backing reader, for paths that have been registered but may not be open. */
  const readers = new Map<string, RangeReader>();
  /** `sqlite3_file*` → backing reader, for files SQLite currently holds open. */
  const openFiles = new Map<number, RangeReader>();
  /** The last transport failure, handed back through `xGetLastError` so the HTTP cause survives. */
  let lastError: string | null = null;

  const ioMethods = new capi.sqlite3_io_methods();
  // The shipped typings spell struct members without the `$` prefix the runtime actually uses, so
  // this one member is set through Object.assign rather than a type assertion. iVersion 1 keeps the
  // struct to the twelve methods below — no shm, which an immutable non-WAL database never needs.
  Object.assign(ioMethods, { $iVersion: 1 });

  const io = {
    xClose: (pFile: number) => {
      openFiles.delete(pFile);
      return capi.SQLITE_OK;
    },
    xRead: (pFile: number, pDest: number, iAmt: number, iOfst: number) => {
      const reader = openFiles.get(pFile);
      if (!reader) return capi.SQLITE_IOERR;
      try {
        const { bytes, got } = reader.read(Number(iOfst), iAmt);
        wasm.heap8u().set(bytes, Number(pDest));
        // A read that runs off the end of the file is normal, not a failure: SQLite wants the tail
        // zeroed (RangeReader already did that) and this specific code, and it recovers from there.
        return got < iAmt ? capi.SQLITE_IOERR_SHORT_READ : capi.SQLITE_OK;
      } catch (error) {
        lastError = describe(error);
        return capi.SQLITE_IOERR_READ;
      }
    },
    xWrite: () => capi.SQLITE_READONLY,
    xTruncate: () => capi.SQLITE_READONLY,
    xSync: () => capi.SQLITE_OK,
    xFileSize: (pFile: number, pSize: number) => {
      const reader = openFiles.get(pFile);
      if (!reader) return capi.SQLITE_IOERR;
      wasm.poke64(pSize, BigInt(reader.size));
      return capi.SQLITE_OK;
    },
    // Locking is a no-op: nothing else can be writing an immutable object, and there is no lock
    // primitive to take over HTTP anyway.
    xLock: () => capi.SQLITE_OK,
    xUnlock: () => capi.SQLITE_OK,
    xCheckReservedLock: (_pFile: number, pOut: number) => {
      wasm.poke32(pOut, 0);
      return capi.SQLITE_OK;
    },
    xFileControl: () => capi.SQLITE_NOTFOUND,
  };

  const vfs = new capi.sqlite3_vfs();
  const probe = new capi.sqlite3_file();
  vfs.$iVersion = 2;
  vfs.$szOsFile = probe.structInfo.sizeof;
  vfs.$mxPathname = MAX_PATHNAME;
  vfs.$zName = wasm.allocCString(RANGE_VFS_NAME, false);
  vfs.addOnDispose(vfs.$zName);
  probe.dispose();

  const vfsMethods = {
    xOpen: (_pVfs: number, zName: number, pFile: number, flags: number, pOutFlags: number) => {
      // Refused before any lookup: a create/write open must never even appear to succeed.
      if (flags & (capi.SQLITE_OPEN_CREATE | capi.SQLITE_OPEN_READWRITE)) {
        lastError = 'this VFS is read-only; databases cannot be created or written';
        return capi.SQLITE_READONLY;
      }
      const path = wasm.cstrToJs(zName);
      const reader = path === null ? undefined : readers.get(path);
      if (!reader) {
        // Sidecar probes (`-wal`, `-journal`) land here and stop, costing nothing over the wire.
        lastError = `no range-backed database is registered at ${path ?? '(null)'}`;
        return capi.SQLITE_CANTOPEN;
      }
      openFiles.set(pFile, reader);
      const file = new capi.sqlite3_file(pFile);
      file.$pMethods = ioMethods.pointer;
      file.dispose();
      wasm.poke32(pOutFlags, flags | capi.SQLITE_OPEN_READONLY);
      return capi.SQLITE_OK;
    },
    xDelete: () => capi.SQLITE_READONLY,
    xAccess: (_pVfs: number, zName: number, _flags: number, pResOut: number) => {
      const path = wasm.cstrToJs(zName);
      wasm.poke32(pResOut, path !== null && readers.has(path) ? 1 : 0);
      return capi.SQLITE_OK;
    },
    xFullPathname: (_pVfs: number, zName: number, nOut: number, zOut: number) => {
      // Paths are already absolute and already canonical — they are minted, not user-supplied.
      return wasm.cstrncpy(zOut, zName, nOut) < nOut ? capi.SQLITE_OK : capi.SQLITE_CANTOPEN;
    },
    xCurrentTime: (_pVfs: number, pTimeOut: number) => {
      wasm.poke(pTimeOut, 2440587.5 + Date.now() / 86400000, 'double');
      return capi.SQLITE_OK;
    },
    xCurrentTimeInt64: (_pVfs: number, pTimeOut: number) => {
      wasm.poke(pTimeOut, 2440587.5 * 86400000 + Date.now(), 'i64');
      return capi.SQLITE_OK;
    },
    xSleep: () => capi.SQLITE_OK,
    xGetLastError: (_pVfs: number, nBuf: number, zBuf: number) => {
      // This is how an HTTP failure reaches the user: without it SQLite reports a bare
      // "disk I/O error" and the 403 or dropped-Range message dies inside xRead.
      const message = lastError ?? '';
      if (nBuf > 0) {
        const encoded = new TextEncoder().encode(message);
        const heap = wasm.heap8u();
        const written = Math.min(encoded.length, nBuf - 1);
        heap.set(encoded.subarray(0, written), zBuf);
        heap[zBuf + written] = 0;
      }
      return capi.SQLITE_OK;
    },
  };

  // These three are the odd ones out: they return a size, a capability bitmask and a byte count,
  // not a result code. The shipped typings model every `x*` member as returning a result code, so
  // they go in through installMethod(), whose signature is honestly loose, instead of through the
  // typed installVfs() methods object below. They are installed first so both structs are complete
  // before the VFS becomes reachable by name.
  ioMethods.installMethod({
    xSectorSize: () => SECTOR_SIZE,
    // IMMUTABLE tells SQLite the bytes cannot change underneath it, which is exactly the promise
    // `immutable=1` makes on the URI, and it lets SQLite skip work that only matters for files
    // other processes might be writing.
    xDeviceCharacteristics: () => capi.SQLITE_IOCAP_IMMUTABLE,
  });
  vfs.installMethod({
    xRandomness: (_pVfs: number, nByte: number, zOut: number) => {
      const heap = wasm.heap8u();
      for (let i = 0; i < nByte; i++) heap[zOut + i] = (Math.random() * 256) & 0xff;
      return nByte;
    },
  });

  sqlite3.vfs.installVfs({
    io: { struct: ioMethods, methods: io },
    vfs: { struct: vfs, methods: vfsMethods },
  });

  return {
    register(path, reader) {
      readers.set(path, reader);
    },
    unregister(path) {
      readers.delete(path);
    },
  };
}
