import type { Readable } from 'node:stream';
import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { MediaConsoleGuard } from './media-console.guard.js';
import { MediaConsoleService } from './media-console.service.js';

interface CopyMoveBody {
  from: string;
  to: string;
}

interface CreateFolderBody {
  prefix: string;
}

/**
 * Destructive JSON API for the /media console. Only registered when the host opts in with
 * `MediaDashboardModule.forRoot({ actions: true })` (default off). Bare `@Controller()` — the path
 * prefix comes from `RouterModule`, sharing the API base with the read controller. Gated by
 * `MediaConsoleGuard` (session cookie) when the host configured `auth`.
 */
@UseGuards(MediaConsoleGuard)
@Controller()
export class MediaConsoleActionsController {
  constructor(@Inject(MediaConsoleService) private readonly service: MediaConsoleService) {}

  @Delete('disks/:disk/object')
  @HttpCode(204)
  deleteObject(@Param('disk') disk: string, @Query('key') key: string): Promise<void> {
    return this.service.deleteObject(disk, key);
  }

  @Post('disks/:disk/copy')
  @HttpCode(204)
  copyObject(@Param('disk') disk: string, @Body() body: CopyMoveBody): Promise<void> {
    return this.service.copyObject(disk, body.from, body.to);
  }

  @Post('disks/:disk/move')
  @HttpCode(204)
  moveObject(@Param('disk') disk: string, @Body() body: CopyMoveBody): Promise<void> {
    return this.service.moveObject(disk, body.from, body.to);
  }

  /**
   * Uploads a file to `key` on the disk. The body is the raw bytes sent as `application/octet-stream`
   * so the host's JSON/urlencoded body parsers never consume the stream; the real MIME rides as the
   * `type` query param and becomes the stored object's Content-Type. `@Req()` is the request stream.
   */
  @Post('disks/:disk/upload')
  @HttpCode(204)
  uploadObject(
    @Param('disk') disk: string,
    @Query('key') key: string,
    @Req() request: Readable,
    @Query('type') type?: string,
  ): Promise<void> {
    return this.service.putObject(disk, key, request, type);
  }

  @Post('disks/:disk/folder')
  @HttpCode(204)
  createFolder(@Param('disk') disk: string, @Body() body: CreateFolderBody): Promise<void> {
    return this.service.createFolder(disk, body.prefix);
  }

  @Delete('disks/:disk/folder')
  @HttpCode(204)
  deleteFolder(@Param('disk') disk: string, @Query('prefix') prefix: string): Promise<void> {
    return this.service.deleteFolder(disk, prefix);
  }

  @Post('uploads/:id/abort')
  @HttpCode(204)
  abortUpload(@Param('id') id: string): Promise<void> {
    return this.service.abortUpload(id);
  }

  @Delete('library/:id')
  @HttpCode(204)
  deleteLibraryRecord(@Param('id') id: string): Promise<void> {
    return this.service.deleteLibraryRecord(id);
  }
}
