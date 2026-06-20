import type { TusRequest, TusUploadHandler } from '@dudousxd/nestjs-media-core';
import {
  Controller,
  Delete,
  Head,
  Headers,
  Inject,
  Options,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { MEDIA_TUS } from './tokens';

/** Minimal Express-like response surface this controller writes to. */
interface ResLike {
  status(code: number): ResLike;
  setHeader(name: string, value: string): void;
  send(body?: string): void;
  end(): void;
}
interface ReqLike {
  body?: Buffer;
}

/**
 * tus endpoints. The app must register a raw-body parser for
 * `application/offset+octet-stream` (e.g. `express.raw({ type: 'application/offset+octet-stream' })`)
 * so PATCH bodies arrive as Buffers.
 */
@Controller('media/uploads')
export class MediaUploadController {
  constructor(@Inject(MEDIA_TUS) private readonly handler: TusUploadHandler) {}

  @Options()
  options(@Res() res: ResLike, @Headers() headers: Record<string, string>): Promise<void> {
    return this.run({ method: 'OPTIONS', headers }, res);
  }

  @Post()
  create(@Res() res: ResLike, @Headers() headers: Record<string, string>): Promise<void> {
    return this.run({ method: 'POST', headers }, res);
  }

  @Head(':id')
  head(
    @Param('id') id: string,
    @Res() res: ResLike,
    @Headers() headers: Record<string, string>,
  ): Promise<void> {
    return this.run({ method: 'HEAD', uploadId: id, headers }, res);
  }

  @Patch(':id')
  patch(
    @Param('id') id: string,
    @Req() req: ReqLike,
    @Res() res: ResLike,
    @Headers() headers: Record<string, string>,
  ): Promise<void> {
    return this.run(
      { method: 'PATCH', uploadId: id, headers, ...(req.body ? { body: req.body } : {}) },
      res,
    );
  }

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @Res() res: ResLike,
    @Headers() headers: Record<string, string>,
  ): Promise<void> {
    return this.run({ method: 'DELETE', uploadId: id, headers }, res);
  }

  private async run(req: TusRequest, res: ResLike): Promise<void> {
    const result = await this.handler.handle(req);
    res.status(result.status);
    for (const [name, value] of Object.entries(result.headers)) res.setHeader(name, value);
    if (result.body !== undefined) res.send(result.body);
    else res.end();
  }
}
