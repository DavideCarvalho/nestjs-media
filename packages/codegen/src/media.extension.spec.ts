import type { ExtensionContext } from '@dudousxd/nestjs-codegen/extension';
import { describe, expect, it } from 'vitest';
import { mediaCodegenExtension } from './media.extension';

const ctx = {} as ExtensionContext;

describe('mediaCodegenExtension', () => {
  it('has a stable name', () => {
    expect(mediaCodegenExtension().name).toBe('nestjs-media');
  });

  it('emits a typed media client with the configured base path', () => {
    const files = mediaCodegenExtension({ basePath: '/api/uploads' }).emitFiles?.(ctx) ?? [];
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe('media-client.ts');
    expect(files[0]?.contents).toContain('export async function uploadMedia');
    expect(files[0]?.contents).toContain('export function mediaUrl');
    expect(files[0]?.contents).toContain('"/api/uploads"');
    expect(files[0]?.contents).toContain("'Content-Type': 'application/offset+octet-stream'");
  });

  it('honors a custom file name', () => {
    const files = mediaCodegenExtension({ fileName: 'media.ts' }).emitFiles?.(ctx) ?? [];
    expect(files[0]?.path).toBe('media.ts');
  });
});
