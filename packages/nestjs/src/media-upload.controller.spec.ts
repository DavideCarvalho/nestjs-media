import { InMemoryDriver, InMemoryUploadSessionStore } from '@dudousxd/nestjs-media-testing';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaUploadController } from './media-upload.controller';
import { MediaModule } from './media.module';

function mockRes() {
  const res = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: undefined as string | undefined,
    ended: false,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    setHeader: vi.fn((name: string, value: string) => {
      res.headers[name] = value;
    }),
    send: vi.fn((b?: string) => {
      res.body = b;
    }),
    end: vi.fn(() => {
      res.ended = true;
    }),
  };
  return res;
}

let controller: MediaUploadController;
let disk: InMemoryDriver;

beforeEach(async () => {
  disk = new InMemoryDriver();
  const mod = await Test.createTestingModule({
    imports: [
      MediaModule.forRoot({
        default: 'local',
        disks: { local: disk },
        uploadSessions: new InMemoryUploadSessionStore(),
        tus: {
          disk: 'local',
          basePath: '/media/uploads',
          keyFor: (filename) => `uploads/${filename}`,
        },
      }),
    ],
  }).compile();
  controller = mod.get(MediaUploadController);
});

const b64 = (s: string) => Buffer.from(s).toString('base64');

describe('MediaUploadController', () => {
  it('is wired when tus is configured', () => {
    expect(controller).toBeInstanceOf(MediaUploadController);
  });

  it('OPTIONS writes tus headers', async () => {
    const res = mockRes();
    await controller.options(res, {});
    expect(res.statusCode).toBe(204);
    expect(res.headers['Tus-Resumable']).toBe('1.0.0');
    expect(res.ended).toBe(true);
  });

  it('POST → PATCH drives a full upload through HTTP', async () => {
    const create = mockRes();
    await controller.create(create, {
      'upload-length': '5',
      'upload-metadata': `filename ${b64('a.txt')}`,
    });
    expect(create.statusCode).toBe(201);
    const id = create.headers.Location.split('/').pop() as string;

    const patch = mockRes();
    await controller.patch(id, { body: Buffer.from('hello') }, patch, {
      'content-type': 'application/offset+octet-stream',
      'upload-offset': '0',
    });
    expect(patch.statusCode).toBe(204);
    expect(patch.headers['Upload-Offset']).toBe('5');
    expect((await disk.get('uploads/a.txt')).toString()).toBe('hello');
  });

  it('is absent when tus is not configured', async () => {
    const mod = await Test.createTestingModule({
      imports: [MediaModule.forRoot({ default: 'local', disks: { local: new InMemoryDriver() } })],
    }).compile();
    expect(() => mod.get(MediaUploadController)).toThrow();
  });
});
