import type { CodegenExtension, EmittedFile } from '@dudousxd/nestjs-codegen/extension';
import { renderMediaClient } from './media-client-template';

export interface MediaCodegenOptions {
  /** tus base path the generated client uploads to. Default `/media/uploads`. */
  basePath?: string;
  /** Emitted file name (relative to outDir). Default `media-client.ts`. */
  fileName?: string;
}

/**
 * Codegen extension that emits a standalone, typed media client (`media-client.ts`)
 * next to the generated `api.ts`: a resumable tus `uploadMedia()` plus a `mediaUrl()`
 * helper. Register it in the codegen config's `extensions` array.
 */
export function mediaCodegenExtension(options: MediaCodegenOptions = {}): CodegenExtension {
  const basePath = options.basePath ?? '/media/uploads';
  const fileName = options.fileName ?? 'media-client.ts';
  return {
    name: 'nestjs-media',
    emitFiles(): EmittedFile[] {
      return [{ path: fileName, contents: renderMediaClient(basePath) }];
    },
  };
}
