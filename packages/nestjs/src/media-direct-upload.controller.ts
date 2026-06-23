import type { DirectUploadManager, MultipartPart } from '@dudousxd/nestjs-media-core';
import {
  Body,
  Controller,
  Delete,
  Inject,
  NotImplementedException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { MEDIA_DIRECT } from './tokens';

interface InitiateBody {
  key: string;
  contentType?: string;
  size?: number;
  partSize?: number;
  disk?: string;
}

interface CompleteBody {
  key: string;
  parts: MultipartPart[];
  disk?: string;
}

@Controller('media/uploads/direct')
export class MediaDirectUploadController {
  constructor(@Inject(MEDIA_DIRECT) private readonly manager: DirectUploadManager | null) {}

  @Post('initiate')
  initiate(@Body() body: InitiateBody) {
    if (!this.manager) throw new NotImplementedException('Direct uploads are not configured.');
    return this.manager.createUpload({
      key: body.key,
      ...(body.contentType !== undefined ? { contentType: body.contentType } : {}),
      ...(body.size !== undefined ? { size: body.size } : {}),
      ...(body.partSize !== undefined ? { partSize: body.partSize } : {}),
      ...(body.disk !== undefined ? { disk: body.disk } : {}),
    });
  }

  @Post(':uploadId/parts/:partNumber')
  presignPart(
    @Param('uploadId') uploadId: string,
    @Param('partNumber') partNumber: string,
    @Query('key') keyQuery: string | undefined,
    @Query('disk') diskQuery: string | undefined,
    @Body() body: { key?: string; disk?: string },
  ) {
    if (!this.manager) throw new NotImplementedException('Direct uploads are not configured.');
    const key = keyQuery ?? body.key;
    if (!key) throw new NotImplementedException('key is required');
    return this.manager.presignPart({
      key,
      uploadId,
      partNumber: Number(partNumber),
      ...(diskQuery !== undefined
        ? { disk: diskQuery }
        : body.disk !== undefined
          ? { disk: body.disk }
          : {}),
    });
  }

  @Post(':uploadId/complete')
  complete(@Param('uploadId') uploadId: string, @Body() body: CompleteBody) {
    if (!this.manager) throw new NotImplementedException('Direct uploads are not configured.');
    return this.manager.completeUpload({
      key: body.key,
      uploadId,
      parts: body.parts,
      ...(body.disk !== undefined ? { disk: body.disk } : {}),
    });
  }

  @Delete(':uploadId')
  abort(
    @Param('uploadId') uploadId: string,
    @Query('key') keyQuery: string | undefined,
    @Query('disk') diskQuery: string | undefined,
    @Body() body: { key?: string; disk?: string },
  ) {
    if (!this.manager) throw new NotImplementedException('Direct uploads are not configured.');
    const key = keyQuery ?? body.key;
    if (!key) throw new NotImplementedException('key is required');
    return this.manager.abortUpload({
      key,
      uploadId,
      ...(diskQuery !== undefined
        ? { disk: diskQuery }
        : body.disk !== undefined
          ? { disk: body.disk }
          : {}),
    });
  }
}
