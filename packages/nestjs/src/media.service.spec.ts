import type { AddressInfo } from 'node:net';
import { InMemoryMediaStore } from '@dudousxd/nestjs-media-testing';
import { Controller, ForbiddenException, Get, Module, Param, Req, Res } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { InMemoryDisk, StorageModule } from '@nestjs/storage';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type MediaAuthorize, MediaModule } from './media.module';
import { MediaService } from './media.service';

let app: NestExpressApplication | undefined;
function running(): NestExpressApplication {
  if (!app) throw new Error('no app booted');
  return app;
}
afterEach(async () => {
  await app?.close();
  app = undefined;
});

@Controller('files')
class FilesController {
  constructor(private readonly media: MediaService) {}

  @Get(':id')
  file(@Param('id') id: string, @Req() req: unknown, @Res({ passthrough: true }) res: unknown) {
    return this.media.serve(id, undefined, { req, res });
  }
}

async function boot(authorize?: MediaAuthorize) {
  const disk = new InMemoryDisk();
  @Module({
    imports: [
      StorageModule.forRoot({ disks: { local: disk } }),
      MediaModule.forRoot({
        store: new InMemoryMediaStore(),
        ...(authorize ? { authorize } : {}),
      }),
    ],
    controllers: [FilesController],
  })
  class AppModule {}
  app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false });
  app.use(
    (req: { headers: Record<string, string>; user?: unknown }, _r: unknown, next: () => void) => {
      if (req.headers['x-user']) req.user = { id: req.headers['x-user'] };
      next();
    },
  );
  await app.listen(0);
  const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  const record = await app.get(MediaService).library.attach({
    ownerType: 'Post',
    ownerId: '1',
    collection: 'docs',
    fileName: 'hello.txt',
    mimeType: 'text/plain',
    contents: Buffer.from('hello world'),
  });
  return { base, record, disk };
}

describe('MediaService.serve', () => {
  it('streams the file with serveFile(): headers, ranges, conditional requests, 404', async () => {
    const { base, record } = await boot();
    const full = await fetch(`${base}/files/${record.id}`);
    expect(full.status).toBe(200);
    expect(await full.text()).toBe('hello world');
    expect(full.headers.get('content-type')).toMatch(/^text\/plain/);
    expect(full.headers.get('content-disposition')).toBe('inline; filename="hello.txt"');
    expect(full.headers.get('x-content-type-options')).toBe('nosniff');

    const ranged = await fetch(`${base}/files/${record.id}`, { headers: { range: 'bytes=6-' } });
    expect(ranged.status).toBe(206);
    expect(await ranged.text()).toBe('world');
    expect(ranged.headers.get('content-range')).toBe('bytes 6-10/11');

    const etag = full.headers.get('etag') ?? '';
    const cached = await fetch(`${base}/files/${record.id}`, {
      headers: { 'if-none-match': etag },
    });
    expect(cached.status).toBe(304);

    expect((await fetch(`${base}/files/nope`)).status).toBe(404);
  });

  it('asks authorize() with req.user, the action and the record, and refuses when it throws', async () => {
    const authorize = vi.fn<MediaAuthorize>(async (user) => {
      if (!user) throw new ForbiddenException();
    });
    const { base, record } = await boot(authorize);
    expect((await fetch(`${base}/files/${record.id}`)).status).toBe(403);
    const allowed = await fetch(`${base}/files/${record.id}`, { headers: { 'x-user': 'u1' } });
    expect(allowed.status).toBe(200);
    expect(authorize).toHaveBeenLastCalledWith(
      { id: 'u1' },
      'read',
      expect.objectContaining({ id: record.id }),
    );
  });
});

describe('MediaService attach/delete/url with authorize', () => {
  it('checks attach on the owner + collection, and delete on the record', async () => {
    const calls: Array<[unknown, string, unknown]> = [];
    const { disk } = await boot(async (user, action, subject) => {
      calls.push([user, action, subject]);
      if (action === 'delete' && user !== 'admin') throw new ForbiddenException();
    });
    const media = running().get(MediaService);
    const record = await media.attach(
      {
        ownerType: 'Post',
        ownerId: '2',
        collection: 'docs',
        fileName: 'a.txt',
        mimeType: 'text/plain',
        contents: Buffer.from('a'),
      },
      { user: 'editor' },
    );
    expect(calls.at(-1)).toEqual([
      'editor',
      'attach',
      { ownerType: 'Post', ownerId: '2', collection: 'docs' },
    ]);
    await expect(media.delete(record.id, { user: 'editor' })).rejects.toThrow(ForbiddenException);
    expect(await disk.exists(record.path)).toBe(true);
    await media.delete(record.id, { user: 'admin' });
    expect(await disk.exists(record.path)).toBe(false);
  });

  it('url() checks read, then signs (the in-memory disk has no signedUrls: its error)', async () => {
    const authorize = vi.fn<MediaAuthorize>(async () => {});
    const { record } = await boot(authorize);
    await expect(
      running().get(MediaService).url(record.id, undefined, { user: 'u' }),
    ).rejects.toThrow(/signedUrls/);
    expect(authorize).toHaveBeenCalledWith('u', 'read', expect.objectContaining({ id: record.id }));
  });
});
