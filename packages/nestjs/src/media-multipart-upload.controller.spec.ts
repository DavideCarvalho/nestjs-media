import { NotImplementedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { MediaMultipartUploadController } from './media-multipart-upload.controller';

function managerStub() {
  return {
    writePart: vi.fn(async (_id: string, partNumber: number) => ({
      partNumber,
      etag: `e${partNumber}`,
    })),
    complete: vi.fn(async () => ({ key: 'k/o.bin', disk: 's3', size: 30 })),
    listParts: vi.fn(async () => [
      { partNumber: 2, etag: 'e2' },
      { partNumber: 1, etag: 'e1' },
    ]),
  };
}

describe('MediaMultipartUploadController', () => {
  it('uploadPart forwards the raw body Buffer and returns the part', async () => {
    const manager = managerStub();
    const controller = new MediaMultipartUploadController(manager as any);
    const body = Buffer.from('chunk');
    const res = await controller.uploadPart('id1', '3', { body });
    expect(manager.writePart).toHaveBeenCalledWith('id1', 3, body);
    expect(res).toEqual({ partNumber: 3, etag: 'e3' });
  });

  it('complete calls the manager', async () => {
    const manager = managerStub();
    const controller = new MediaMultipartUploadController(manager as any);
    expect(await controller.complete('id1')).toEqual({ key: 'k/o.bin', disk: 's3', size: 30 });
    expect(manager.complete).toHaveBeenCalledWith('id1');
  });

  it('listParts returns the uploaded part numbers', async () => {
    const manager = managerStub();
    const controller = new MediaMultipartUploadController(manager as any);
    expect(await controller.listParts('id1')).toEqual({ parts: [2, 1] });
  });

  it('501s when the manager is not configured', async () => {
    const controller = new MediaMultipartUploadController(null);
    await expect(controller.complete('id1')).rejects.toBeInstanceOf(NotImplementedException);
  });
});
