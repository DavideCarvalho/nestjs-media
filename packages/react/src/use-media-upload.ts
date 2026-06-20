import { useCallback, useState } from 'react';
import { type UploadMediaResult, uploadMedia } from './tus-upload';

export interface UseMediaUploadOptions {
  basePath?: string;
  chunkSize?: number;
  fetchImpl?: typeof fetch;
}

export type MediaUploadStatus = 'idle' | 'uploading' | 'done' | 'error';

export interface MediaUploadState {
  status: MediaUploadStatus;
  /** 0..1 */
  progress: number;
  location: string | undefined;
  error: Error | undefined;
}

export interface UseMediaUpload extends MediaUploadState {
  upload: (
    file: Blob,
    meta: { filename: string; contentType?: string },
  ) => Promise<UploadMediaResult>;
  reset: () => void;
}

const INITIAL: MediaUploadState = {
  status: 'idle',
  progress: 0,
  location: undefined,
  error: undefined,
};

/** Resumable upload with progress/status state, backed by the tus client. */
export function useMediaUpload(options: UseMediaUploadOptions = {}): UseMediaUpload {
  const [state, setState] = useState<MediaUploadState>(INITIAL);

  const upload = useCallback(
    async (file: Blob, meta: { filename: string; contentType?: string }) => {
      setState({ status: 'uploading', progress: 0, location: undefined, error: undefined });
      try {
        const result = await uploadMedia(file, {
          filename: meta.filename,
          ...(meta.contentType ? { contentType: meta.contentType } : {}),
          ...(options.basePath ? { basePath: options.basePath } : {}),
          ...(options.chunkSize ? { chunkSize: options.chunkSize } : {}),
          ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
          onProgress: (sent, total) =>
            setState((s) => ({ ...s, progress: total ? sent / total : 0 })),
        });
        setState({ status: 'done', progress: 1, location: result.location, error: undefined });
        return result;
      } catch (err) {
        setState({ status: 'error', progress: 0, location: undefined, error: err as Error });
        throw err;
      }
    },
    [options.basePath, options.chunkSize, options.fetchImpl],
  );

  const reset = useCallback(() => setState(INITIAL), []);

  return { ...state, upload, reset };
}
