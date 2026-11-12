import { InMemoryMediaStore, InMemoryUploadSessionStore } from '@dudousxd/nestjs-media-testing';
import { NotImplementedException } from '@nestjs/common';
import { InMemoryDisk, StorageModule } from '@nestjs/storage';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { MediaDirectUploadController } from './media-direct-upload.controller';
import { MediaUploadController } from './media-upload.controller';
import { MediaModule } from './media.module';
import { MediaService } from './media.service';
import {
  MEDIA_LIBRARY,
  MEDIA_MULTIPART,
  MEDIA_STORE,
  MEDIA_UPLOADS,
  MEDIA_UPLOAD_SESSIONS,
} from './tokens';

describe('MediaModule', () => {
  it('forRoot stores attachments on the StorageModule disks', async () => {
    const local = new InMemoryDisk();
    const mod = await Test.createTestingModule({
      imports: [StorageModule.forRoot({ disks: { local } }), MediaModule.forRoot({})],
    }).compile();

    const media = mod.get(MediaService);
    const att = await media.attachments.createFromFile({
      fileName: 'hi.txt',
      mimeType: 'text/plain',
      contents: Buffer.from('yo'),
    });
    expect(await local.getText(att.path)).toBe('yo');
  });

  it('boots with the library and upload manager replaced by pre-tenancy test doubles', async () => {
    const local = new InMemoryDisk();
    const mod = await Test.createTestingModule({
      imports: [StorageModule.forRoot({ disks: { local } }), MediaModule.forRoot({})],
    })
      .overrideProvider(MEDIA_LIBRARY)
      .useValue({ list: async () => [] })
      .overrideProvider(MEDIA_UPLOADS)
      .useValue({ createUpload: async () => ({}), abort: async () => {} })
      .compile();
    const app = mod.createNestApplication();
    await expect(app.init()).resolves.toBeDefined();
    await app.close();
  });

  it('without StorageModule, boot fails naming it', async () => {
    await expect(
      Test.createTestingModule({ imports: [MediaModule.forRoot({})] }).compile(),
    ).rejects.toThrow(/StorageModule\.forRoot/);
  });

  it('a multipart side-car for a disk StorageModule lacks fails at boot', async () => {
    await expect(
      Test.createTestingModule({
        imports: [
          StorageModule.forRoot({ disks: { local: new InMemoryDisk() } }),
          MediaModule.forRoot({ multipart: { s3: {} as never } }),
        ],
      }).compile(),
    ).rejects.toThrow(/multipart\.s3/);
  });

  it('a store factory is resolved by Nest with its injected dependencies', async () => {
    const store = new InMemoryMediaStore();
    const CONNECTION = 'CONNECTION';
    const mod = await Test.createTestingModule({
      imports: [
        StorageModule.forRoot({ disks: { local: new InMemoryDisk() } }),
        MediaModule.forRoot({
          store: {
            inject: [CONNECTION],
            useFactory: (c: { store: InMemoryMediaStore }) => c.store,
          },
          imports: [
            {
              module: class ConnectionModule {},
              providers: [{ provide: CONNECTION, useValue: { store } }],
              exports: [CONNECTION],
            },
          ],
        }),
      ],
    }).compile();
    expect(mod.get(MEDIA_STORE, { strict: false })).toBe(store);
  });

  it('forRootAsync resolves options from a factory', async () => {
    const s3 = new InMemoryDisk();
    const mod = await Test.createTestingModule({
      imports: [
        StorageModule.forRoot({ disks: { s3 } }),
        MediaModule.forRootAsync({ useFactory: () => ({}) }),
      ],
    }).compile();

    const att = await mod.get(MediaService).attachments.createFromFile({
      fileName: 'a.txt',
      mimeType: 'text/plain',
      contents: Buffer.from('x'),
    });
    expect(att.disk).toBe('s3');
    expect(await s3.exists(att.path)).toBe(true);
  });

  // forRootAsync cannot know at build time whether tus/direct are configured
  // (options resolve later via useFactory), so it always mounts both upload
  // controllers. When their feature is unconfigured the mounted handlers must
  // respond with a clear, uniform 501 NotImplemented rather than 404.
  it('forRootAsync mounts both upload controllers and they respond 501 when unconfigured', async () => {
    const local = new InMemoryDisk();
    const mod = await Test.createTestingModule({
      imports: [
        StorageModule.forRoot({ disks: { local } }),
        MediaModule.forRootAsync({ useFactory: () => ({}) }),
      ],
    }).compile();

    const tus = mod.get(MediaUploadController);
    const direct = mod.get(MediaDirectUploadController);
    expect(tus).toBeInstanceOf(MediaUploadController);
    expect(direct).toBeInstanceOf(MediaDirectUploadController);

    await expect(tus.create({ status: () => ({}) as never } as never, {})).rejects.toThrow(
      NotImplementedException,
    );
    expect(() => direct.initiate({ key: 'x' })).toThrow(NotImplementedException);
  });

  it('forRoot exposes the store and upload-session store under stable Symbol.for tokens', async () => {
    const store = new InMemoryMediaStore();
    const sessions = new InMemoryUploadSessionStore();
    const local = new InMemoryDisk();
    const mod = await Test.createTestingModule({
      imports: [
        StorageModule.forRoot({ disks: { local } }),
        MediaModule.forRoot({
          store,
          uploadSessions: sessions,
        }),
      ],
    }).compile();

    expect(mod.get(MEDIA_STORE, { strict: false })).toBe(store);
    expect(mod.get(MEDIA_UPLOAD_SESSIONS, { strict: false })).toBe(sessions);
    // Symbol.for identity: an independently-declared symbol resolves the same provider.
    expect(mod.get(Symbol.for('nestjs-media:store'), { strict: false })).toBe(store);
    expect(mod.get(Symbol.for('nestjs-media:upload-sessions'), { strict: false })).toBe(sessions);
  });

  it('forRoot exposes null tokens when store/uploadSessions are not configured', async () => {
    const local = new InMemoryDisk();
    const mod = await Test.createTestingModule({
      imports: [StorageModule.forRoot({ disks: { local } }), MediaModule.forRoot({})],
    }).compile();

    expect(mod.get(MEDIA_STORE, { strict: false })).toBeNull();
    expect(mod.get(MEDIA_UPLOAD_SESSIONS, { strict: false })).toBeNull();
  });

  it('exposes the multipart side-cars under a stable Symbol.for token', async () => {
    const sidecar = {} as never;
    const mod = await Test.createTestingModule({
      imports: [
        StorageModule.forRoot({ disks: { s3: new InMemoryDisk() } }),
        MediaModule.forRoot({ multipart: { s3: sidecar } }),
      ],
    }).compile();
    expect(mod.get(MEDIA_MULTIPART, { strict: false })).toEqual({ s3: sidecar });
    expect(mod.get(Symbol.for('nestjs-media:multipart'), { strict: false }).s3).toBe(sidecar);
  });

  it('forRootAsync exposes the store and upload-session store under stable Symbol.for tokens', async () => {
    const store = new InMemoryMediaStore();
    const sessions = new InMemoryUploadSessionStore();
    const local = new InMemoryDisk();
    const mod = await Test.createTestingModule({
      imports: [
        StorageModule.forRoot({ disks: { local } }),
        MediaModule.forRootAsync({
          useFactory: () => ({
            store,
            uploadSessions: sessions,
          }),
        }),
      ],
    }).compile();

    expect(mod.get(MEDIA_STORE, { strict: false })).toBe(store);
    expect(mod.get(MEDIA_UPLOAD_SESSIONS, { strict: false })).toBe(sessions);
  });
});
