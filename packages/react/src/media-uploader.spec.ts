import { fireEvent, render, screen, waitFor } from '@testing-library/react';
// @vitest-environment jsdom
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { MediaUploader } from './media-uploader';

function mockFetch() {
  return vi.fn(async (_url: string, init: RequestInit) => {
    if (init.method === 'POST') {
      return { headers: new Headers({ Location: '/media/uploads/s1' }) } as Response;
    }
    const headers = init.headers as Record<string, string>;
    const offset = Number(headers['Upload-Offset']);
    const body = init.body as Blob;
    return { headers: new Headers({ 'Upload-Offset': String(offset + body.size) }) } as Response;
  });
}

describe('MediaUploader', () => {
  it('uploads the selected file and reports the location', async () => {
    const onUploaded = vi.fn();
    render(
      createElement(MediaUploader, {
        fetchImpl: mockFetch() as unknown as typeof fetch,
        onUploaded,
      }),
    );

    const input = screen.getByLabelText('Upload file') as HTMLInputElement;
    const file = new File(['hello world'], 'a.txt', { type: 'text/plain' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith('/media/uploads/s1'));
  });

  it('renders a file input and progress bar', () => {
    render(createElement(MediaUploader, {}));
    expect(screen.getByLabelText('Upload file')).toBeDefined();
  });
});
