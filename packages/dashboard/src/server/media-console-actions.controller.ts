import { Body, Controller, Delete, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { MediaConsoleService } from './media-console.service.js';

interface CopyMoveBody {
  from: string;
  to: string;
}

/**
 * Destructive JSON API for the /media console. Only registered when the host opts in with
 * `MediaDashboardModule.forRoot({ actions: true })` (default off). Bare `@Controller()` — the path
 * prefix comes from `RouterModule`, sharing the API base with the read controller.
 */
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
