// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMediaUpload } from './use-media-upload';

const uploadMediaMock = vi.fn(async () => ({ location: '/media/uploads/seq' }));
const uploadMediaParallelMock = vi.fn(async () => ({ location: '/media/uploads/par' }));

vi.mock('@dudousxd/nestjs-media-client', () => ({
  uploadMedia: (...args: unknown[]) => uploadMediaMock(...args),
  uploadMediaParallel: (...args: unknown[]) => uploadMediaParallelMock(...args),
}));

describe('useMediaUpload parallel routing', () => {
  beforeEach(() => {
    uploadMediaMock.mockClear();
    uploadMediaParallelMock.mockClear();
  });

  it('calls uploadMedia (not uploadMediaParallel) by default', async () => {
    const { result } = renderHook(() => useMediaUpload());
    const file = new File(['hello world'], 'a.txt', { type: 'text/plain' });

    await act(async () => {
      await result.current.upload(file, { filename: 'a.txt', contentType: 'text/plain' });
    });

    expect(uploadMediaMock).toHaveBeenCalledTimes(1);
    expect(uploadMediaParallelMock).not.toHaveBeenCalled();
  });

  it('routes to uploadMediaParallel when parallel is set', async () => {
    const { result } = renderHook(() => useMediaUpload({ parallel: true }));
    const file = new File(['hello world'], 'a.txt', { type: 'text/plain' });

    await act(async () => {
      await result.current.upload(file, { filename: 'a.txt', contentType: 'text/plain' });
    });

    expect(uploadMediaParallelMock).toHaveBeenCalledTimes(1);
    expect(uploadMediaMock).not.toHaveBeenCalled();
  });

  it('passes concurrency through to uploadMediaParallel when parallel is set', async () => {
    const { result } = renderHook(() => useMediaUpload({ parallel: true, concurrency: 7 }));
    const file = new File(['hello world'], 'a.txt', { type: 'text/plain' });

    await act(async () => {
      await result.current.upload(file, { filename: 'a.txt', contentType: 'text/plain' });
    });

    expect(uploadMediaParallelMock).toHaveBeenCalledTimes(1);
    const [, callOptions] = uploadMediaParallelMock.mock.calls[0] as [
      Blob,
      { concurrency?: number },
    ];
    expect(callOptions.concurrency).toBe(7);
  });
});
