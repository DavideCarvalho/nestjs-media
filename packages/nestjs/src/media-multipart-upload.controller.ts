import type { ResumableUploadManager } from '@dudousxd/nestjs-media-core';
import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  NotImplementedException,
  Param,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { MEDIA_UPLOADS } from './tokens';

/** Express-like request exposing the raw body Buffer (host must mount a raw parser on the parts path). */
interface ReqLike {
  body?: Buffer;
}

/**
 * Proxy-parallel multipart routes. Bytes flow through the backend: the client
 * PUTs each part (by explicit number) and the backend forwards it to a native
 * S3 multipart part, then a single complete call assembles them. The key/disk
 * are resolved from the session id — never from the client — so this is
 * GameWarden-safe and cannot be pointed at another object.
 *
 * The app MUST mount a raw-body parser with a per-part size cap on
 * `…/media/uploads/:id/parts/:n` so the PUT body arrives as a Buffer.
 */
@Controller('media/uploads')
export class MediaMultipartUploadController {
  constructor(@Inject(MEDIA_UPLOADS) private readonly manager: ResumableUploadManager | null) {}

  private requireManager(): ResumableUploadManager {
    if (!this.manager) throw new NotImplementedException('Uploads are not configured.');
    return this.manager;
  }

  @Put(':id/parts/:partNumber')
  async uploadPart(
    @Param('id') id: string,
    @Param('partNumber') partNumber: string,
    @Req() req: ReqLike,
  ) {
    const manager = this.requireManager();
    if (!req.body || req.body.byteLength === 0) {
      throw new BadRequestException(
        'Empty upload part body — ensure a raw-body parser with a size cap is mounted on this route.',
      );
    }
    return manager.writePart(id, Number(partNumber), req.body);
  }

  @Post(':id/complete')
  async complete(@Param('id') id: string) {
    const manager = this.requireManager();
    return manager.complete(id);
  }

  @Get(':id/parts')
  async listParts(@Param('id') id: string): Promise<{ parts: number[] }> {
    const manager = this.requireManager();
    const parts = await manager.listParts(id);
    return { parts: parts.map((part) => part.partNumber) };
  }
}
