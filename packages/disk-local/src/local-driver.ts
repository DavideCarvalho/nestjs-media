import { createReadStream } from 'node:fs';
import {
  copyFile,
  stat as fsStat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Readable } from 'node:stream';
import {
  type DriverCapabilities,
  FileNotFoundError,
  type ListEntry,
  type ListOptions,
  type ListResult,
  type PutOptions,
  type StatResult,
  type StorageDriver,
  UnsupportedOperationError,
  collectStream,
} from '@dudousxd/nestjs-media-core';
import { resolveWithinRoot } from './path-safety';

export interface LocalDriverOptions {
  root: string;
  baseUrl?: string;
}

const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  txt: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  xml: 'application/xml',
  html: 'text/html',
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  zip: 'application/zip',
  sqlite: 'application/vnd.sqlite3',
};

function contentTypeFromExtension(path: string): string | undefined {
  const extension = path.split('.').pop()?.toLowerCase();
  return extension ? CONTENT_TYPE_BY_EXTENSION[extension] : undefined;
}

export class LocalDriver implements StorageDriver {
  readonly capabilities: DriverCapabilities;
  private readonly root: string;
  private readonly baseUrl: string | undefined;

  constructor(options: LocalDriverOptions) {
    this.root = options.root;
    this.baseUrl = options.baseUrl;
    this.capabilities = {
      presign: false,
      multipart: false,
      publicUrls: !!options.baseUrl,
      list: true,
    };
  }

  private abs(path: string): string {
    return resolveWithinRoot(this.root, path);
  }

  async put(path: string, contents: Buffer | Readable, _options?: PutOptions): Promise<void> {
    const abs = this.abs(path);
    await mkdir(dirname(abs), { recursive: true });
    const data = Buffer.isBuffer(contents) ? contents : await collectStream(contents);
    await writeFile(abs, data);
  }

  async get(path: string): Promise<Buffer> {
    try {
      return await readFile(this.abs(path));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new FileNotFoundError(path);
      throw e;
    }
  }

  async stream(path: string): Promise<Readable> {
    if (!(await this.exists(path))) throw new FileNotFoundError(path);
    return createReadStream(this.abs(path));
  }

  async exists(path: string): Promise<boolean> {
    try {
      await fsStat(this.abs(path));
      return true;
    } catch {
      return false;
    }
  }

  async size(path: string): Promise<number> {
    try {
      return (await fsStat(this.abs(path))).size;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new FileNotFoundError(path);
      throw e;
    }
  }

  async stat(path: string): Promise<StatResult> {
    let stats: import('node:fs').Stats;
    try {
      stats = await fsStat(this.abs(path));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new FileNotFoundError(path);
      throw err;
    }
    const contentType = contentTypeFromExtension(path);
    return {
      size: stats.size,
      lastModified: stats.mtime,
      ...(contentType ? { contentType } : {}),
    };
  }

  async delete(path: string): Promise<void> {
    await rm(this.abs(path), { force: true });
  }

  async deleteMany(paths: string[]): Promise<void> {
    for (const path of paths) await this.delete(path);
  }

  async copy(from: string, to: string): Promise<void> {
    const dst = this.abs(to);
    await mkdir(dirname(dst), { recursive: true });
    await copyFile(this.abs(from), dst);
  }

  async move(from: string, to: string): Promise<void> {
    const dst = this.abs(to);
    await mkdir(dirname(dst), { recursive: true });
    await rename(this.abs(from), dst);
  }

  async url(path: string): Promise<string> {
    if (!this.baseUrl) throw new UnsupportedOperationError('local', 'url');
    return `${this.baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
  }

  async temporaryUrl(_path: string, _expiresInSeconds: number): Promise<string> {
    throw new UnsupportedOperationError('local', 'temporaryUrl');
  }

  async list(prefix: string, _options?: ListOptions): Promise<ListResult> {
    const cleanPrefix = prefix.replace(/\/+$/, '');
    const absDir = this.abs(cleanPrefix);
    let dirents: import('node:fs').Dirent[];
    try {
      dirents = await readdir(absDir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { folders: [], files: [] };
      }
      throw error;
    }
    const folders: string[] = [];
    const files: ListEntry[] = [];
    for (const dirent of dirents) {
      const key = cleanPrefix ? `${cleanPrefix}/${dirent.name}` : dirent.name;
      if (dirent.isDirectory()) {
        folders.push(`${key}/`);
      } else {
        const stats = await fsStat(this.abs(key));
        files.push({ key, name: dirent.name, sizeBytes: stats.size, lastModified: stats.mtime });
      }
    }
    return { folders, files };
  }
}
