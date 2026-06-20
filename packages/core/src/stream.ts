import type { Readable } from 'node:stream';

/** Collect a Readable stream into a single Buffer. */
export async function collectStream(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
