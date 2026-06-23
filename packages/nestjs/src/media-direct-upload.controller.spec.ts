import type { DirectUploadCreated, MultipartPart } from '@dudousxd/nestjs-media-core';
import { NotImplementedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaDirectUploadController } from './media-direct-upload.controller';
import { MEDIA_DIRECT } from './tokens';

function mockManager() {
  return {
    createUpload: vi.fn(),
    presignPart: vi.fn(),
    completeUpload: vi.fn(),
    abortUpload: vi.fn(),
  };
}

let controller: MediaDirectUploadController;
let manager: ReturnType<typeof mockManager>;

beforeEach(async () => {
  manager = mockManager();
  const mod = await Test.createTestingModule({
    controllers: [MediaDirectUploadController],
    providers: [{ provide: MEDIA_DIRECT, useValue: manager }],
  }).compile();
  controller = mod.get(MediaDirectUploadController);
});

describe('MediaDirectUploadController', () => {
  describe('initiate', () => {
    it('delegates to manager.createUpload with full body', async () => {
      const created: DirectUploadCreated = {
        uploadId: 'u1',
        key: 'files/a.mp4',
        disk: 's3',
        partSize: 8 * 1024 * 1024,
        parts: [{ partNumber: 1, url: 'https://example.com/part1' }],
      };
      manager.createUpload.mockResolvedValue(created);

      const result = await controller.initiate({
        key: 'files/a.mp4',
        contentType: 'video/mp4',
        size: 1024,
        partSize: 8 * 1024 * 1024,
        disk: 's3',
      });

      expect(manager.createUpload).toHaveBeenCalledWith({
        key: 'files/a.mp4',
        contentType: 'video/mp4',
        size: 1024,
        partSize: 8 * 1024 * 1024,
        disk: 's3',
      });
      expect(result).toBe(created);
    });

    it('delegates to manager.createUpload with only key', async () => {
      manager.createUpload.mockResolvedValue({
        uploadId: 'u2',
        key: 'f.txt',
        disk: 's3',
        partSize: 8388608,
        parts: [],
      });

      await controller.initiate({ key: 'f.txt' });

      expect(manager.createUpload).toHaveBeenCalledWith({ key: 'f.txt' });
    });
  });

  describe('presignPart', () => {
    it('delegates to manager.presignPart with query key', async () => {
      manager.presignPart.mockResolvedValue({ url: 'https://example.com/p' });

      const result = await controller.presignPart('upload-abc', '2', 'files/a.mp4', undefined, {});

      expect(manager.presignPart).toHaveBeenCalledWith({
        key: 'files/a.mp4',
        uploadId: 'upload-abc',
        partNumber: 2,
      });
      expect(result).toEqual({ url: 'https://example.com/p' });
    });

    it('delegates to manager.presignPart with body key and disk', async () => {
      manager.presignPart.mockResolvedValue({ url: 'https://example.com/p2' });

      await controller.presignPart('upload-abc', '3', undefined, 's3', {
        key: 'files/b.mp4',
        disk: 's3',
      });

      expect(manager.presignPart).toHaveBeenCalledWith({
        key: 'files/b.mp4',
        uploadId: 'upload-abc',
        partNumber: 3,
        disk: 's3',
      });
    });
  });

  describe('complete', () => {
    it('delegates to manager.completeUpload', async () => {
      manager.completeUpload.mockResolvedValue({ key: 'files/a.mp4', disk: 's3' });
      const parts: MultipartPart[] = [{ partNumber: 1, etag: 'abc123' }];

      const result = await controller.complete('upload-abc', {
        key: 'files/a.mp4',
        parts,
        disk: 's3',
      });

      expect(manager.completeUpload).toHaveBeenCalledWith({
        key: 'files/a.mp4',
        uploadId: 'upload-abc',
        parts,
        disk: 's3',
      });
      expect(result).toEqual({ key: 'files/a.mp4', disk: 's3' });
    });

    it('delegates without disk when omitted', async () => {
      manager.completeUpload.mockResolvedValue({ key: 'f.txt', disk: 'default' });
      const parts: MultipartPart[] = [{ partNumber: 1, etag: 'def456' }];

      await controller.complete('upload-xyz', { key: 'f.txt', parts });

      expect(manager.completeUpload).toHaveBeenCalledWith({
        key: 'f.txt',
        uploadId: 'upload-xyz',
        parts,
      });
    });
  });

  describe('abort', () => {
    it('delegates to manager.abortUpload with query key', async () => {
      manager.abortUpload.mockResolvedValue(undefined);

      await controller.abort('upload-abc', 'files/a.mp4', undefined, {});

      expect(manager.abortUpload).toHaveBeenCalledWith({
        key: 'files/a.mp4',
        uploadId: 'upload-abc',
      });
    });

    it('delegates to manager.abortUpload with body key and disk', async () => {
      manager.abortUpload.mockResolvedValue(undefined);

      await controller.abort('upload-abc', undefined, 's3', { key: 'files/a.mp4', disk: 's3' });

      expect(manager.abortUpload).toHaveBeenCalledWith({
        key: 'files/a.mp4',
        uploadId: 'upload-abc',
        disk: 's3',
      });
    });
  });

  describe('NotImplementedException when manager is null', () => {
    let nullController: MediaDirectUploadController;

    beforeEach(async () => {
      const mod = await Test.createTestingModule({
        controllers: [MediaDirectUploadController],
        providers: [{ provide: MEDIA_DIRECT, useValue: null }],
      }).compile();
      nullController = mod.get(MediaDirectUploadController);
    });

    it('initiate throws NotImplementedException', () => {
      expect(() => nullController.initiate({ key: 'x' })).toThrow(NotImplementedException);
    });

    it('presignPart throws NotImplementedException', () => {
      expect(() => nullController.presignPart('u', '1', 'x', undefined, {})).toThrow(
        NotImplementedException,
      );
    });

    it('complete throws NotImplementedException', () => {
      expect(() => nullController.complete('u', { key: 'x', parts: [] })).toThrow(
        NotImplementedException,
      );
    });

    it('abort throws NotImplementedException', () => {
      expect(() => nullController.abort('u', 'x', undefined, {})).toThrow(NotImplementedException);
    });
  });
});
