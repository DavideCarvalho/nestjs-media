import { createElement } from 'react';
import { useMediaUpload } from './use-media-upload';

export interface MediaUploaderProps {
  basePath?: string;
  chunkSize?: number;
  fetchImpl?: typeof fetch;
  accept?: string;
  /** Called with the created upload Location after a successful upload. */
  onUploaded?: (location: string) => void;
  onError?: (error: Error) => void;
}

/**
 * Minimal file uploader: a file input + a progress bar wired to `useMediaUpload`.
 * Authored with `createElement` (no JSX) so the package builds without a JSX
 * toolchain; consumers can style/replace it freely.
 */
export function MediaUploader(props: MediaUploaderProps) {
  const { upload, status, progress } = useMediaUpload({
    ...(props.basePath ? { basePath: props.basePath } : {}),
    ...(props.chunkSize ? { chunkSize: props.chunkSize } : {}),
    ...(props.fetchImpl ? { fetchImpl: props.fetchImpl } : {}),
  });

  const onChange = async (event: { target: { files: FileList | null } }) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const result = await upload(file, { filename: file.name, contentType: file.type });
      props.onUploaded?.(result.location);
    } catch (err) {
      props.onError?.(err as Error);
    }
  };

  return createElement(
    'div',
    { 'data-media-uploader': '', 'data-status': status },
    createElement('input', {
      type: 'file',
      'aria-label': 'Upload file',
      ...(props.accept ? { accept: props.accept } : {}),
      onChange,
    }),
    createElement('progress', { value: progress, max: 1 }),
  );
}
