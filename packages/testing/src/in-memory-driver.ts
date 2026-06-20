import { Readable } from 'node:stream';
import {
  type DriverCapabilities,
  FileNotFoundError,
  type PutOptions,
  type StorageDriver,
  UnsupportedOperationError,
} from '@dudousxd/nestjs-media-core';

export class InMemoryDriver implements StorageDriver {
  readonly capabilities: DriverCapabilities = {
    presign: false,
    multipart: false,
    publicUrls: false,
  };
  private readonly files = new Map<string, Buffer>();

  async put(path: string, contents: Buffer | Readable, _options?: PutOptions): Promise<void> {
    this.files.set(path, Buffer.isBuffer(contents) ? contents : await toBuffer(contents));
  }

  async get(path: string): Promise<Buffer> {
    const f = this.files.get(path);
    if (!f) throw new FileNotFoundError(path);
    return f;
  }

  async stream(path: string): Promise<Readable> {
    return Readable.from(await this.get(path));
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async size(path: string): Promise<number> {
    return (await this.get(path)).byteLength;
  }

  async delete(path: string): Promise<void> {
    this.files.delete(path);
  }

  async copy(from: string, to: string): Promise<void> {
    this.files.set(to, await this.get(from));
  }

  async move(from: string, to: string): Promise<void> {
    await this.copy(from, to);
    this.files.delete(from);
  }

  async url(_path: string): Promise<string> {
    throw new UnsupportedOperationError('memory', 'url');
  }

  async temporaryUrl(_path: string, _expiresInSeconds: number): Promise<string> {
    throw new UnsupportedOperationError('memory', 'temporaryUrl');
  }
}

async function toBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
