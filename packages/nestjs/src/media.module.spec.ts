import {
  InMemoryDriver,
  InMemoryMediaStore,
  InMemoryUploadSessionStore,
} from '@dudousxd/nestjs-media-testing';
import { NotImplementedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { MediaDirectUploadController } from './media-direct-upload.controller';
import { MediaUploadController } from './media-upload.controller';
import { MediaModule } from './media.module';
import { MediaService } from './media.service';
import { MEDIA_STORAGE, MEDIA_STORAGE_SHARED, MEDIA_STORE, MEDIA_UPLOAD_SESSIONS } from './tokens';

describe('MediaModule', () => {
  it('forRoot wires MediaService with the configured disks', async () => {
    const local = new InMemoryDriver();
    const mod = await Test.createTestingModule({
      imports: [MediaModule.forRoot({ default: 'local', disks: { local } })],
    }).compile();

    const media = mod.get(MediaService);
    expect(media.disk()).toBe(local);
    await media.disk().put('hi.txt', Buffer.from('yo'));
    expect((await media.disk('local').get('hi.txt')).toString()).toBe('yo');
  });

  it('forRootAsync resolves options from a factory', async () => {
    const s3 = new InMemoryDriver();
    const mod = await Test.createTestingModule({
      imports: [MediaModule.forRootAsync({ useFactory: () => ({ default: 's3', disks: { s3 } }) })],
    }).compile();

    expect(mod.get(MediaService).disk()).toBe(s3);
  });

  // forRootAsync cannot know at build time whether tus/direct are configured
  // (options resolve later via useFactory), so it always mounts both upload
  // controllers. When their feature is unconfigured the mounted handlers must
  // respond with a clear, uniform 501 NotImplemented rather than 404.
  it('forRootAsync mounts both upload controllers and they respond 501 when unconfigured', async () => {
    const local = new InMemoryDriver();
    const mod = await Test.createTestingModule({
      imports: [
        MediaModule.forRootAsync({ useFactory: () => ({ default: 'local', disks: { local } }) }),
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
    const local = new InMemoryDriver();
    const mod = await Test.createTestingModule({
      imports: [
        MediaModule.forRoot({
          default: 'local',
          disks: { local },
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
    const local = new InMemoryDriver();
    const mod = await Test.createTestingModule({
      imports: [MediaModule.forRoot({ default: 'local', disks: { local } })],
    }).compile();

    expect(mod.get(MEDIA_STORE, { strict: false })).toBeNull();
    expect(mod.get(MEDIA_UPLOAD_SESSIONS, { strict: false })).toBeNull();
  });

  it('forRoot exposes the StorageManager under MEDIA_STORAGE_SHARED, aliasing MEDIA_STORAGE', async () => {
    const local = new InMemoryDriver();
    const mod = await Test.createTestingModule({
      imports: [MediaModule.forRoot({ default: 'local', disks: { local } })],
    }).compile();

    expect(mod.get(MEDIA_STORAGE_SHARED, { strict: false })).toBe(mod.get(MEDIA_STORAGE));
    expect(mod.get(Symbol.for('nestjs-media:storage'), { strict: false })).toBe(
      mod.get(MEDIA_STORAGE),
    );
  });

  it('forRootAsync exposes the StorageManager under MEDIA_STORAGE_SHARED, aliasing MEDIA_STORAGE', async () => {
    const s3 = new InMemoryDriver();
    const mod = await Test.createTestingModule({
      imports: [MediaModule.forRootAsync({ useFactory: () => ({ default: 's3', disks: { s3 } }) })],
    }).compile();

    expect(mod.get(MEDIA_STORAGE_SHARED, { strict: false })).toBe(mod.get(MEDIA_STORAGE));
  });

  it('forRootAsync exposes the store and upload-session store under stable Symbol.for tokens', async () => {
    const store = new InMemoryMediaStore();
    const sessions = new InMemoryUploadSessionStore();
    const local = new InMemoryDriver();
    const mod = await Test.createTestingModule({
      imports: [
        MediaModule.forRootAsync({
          useFactory: () => ({
            default: 'local',
            disks: { local },
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
