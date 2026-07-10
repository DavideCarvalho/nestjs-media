import { Controller, Get, Inject, Param, Query, StreamableFile, UseGuards } from '@nestjs/common';
import type {
  CollectionsResponse,
  DiskListResponse,
  LibraryDetailResponse,
  LibraryListResponse,
  ObjectDetailResponse,
  ObjectListResponse,
  Topology,
  UploadDetailResponse,
  UploadListResponse,
} from '../client/types.js';
import { MediaConsoleGuard } from './media-console.guard.js';
import { MediaConsoleService } from './media-console.service.js';

/** Parse an optional numeric query param; undefined when absent or not a finite number. */
function toLimit(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

/**
 * Read-only JSON API for the /media console. Bare `@Controller()` — the path prefix is applied by
 * `RouterModule` (set in `MediaDashboardModule.forRoot({ apiBasePath })`). Always mounted.
 * `MediaConsoleGuard` gates it on a session cookie when the host configured `auth` (else a no-op).
 */
@UseGuards(MediaConsoleGuard)
@Controller()
export class MediaConsoleReadController {
  constructor(@Inject(MediaConsoleService) private readonly service: MediaConsoleService) {}

  @Get('disks')
  disks(): DiskListResponse {
    return this.service.listDisks();
  }

  @Get('disks/:disk/objects')
  objects(
    @Param('disk') disk: string,
    @Query('prefix') prefix?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<ObjectListResponse> {
    const limitValue = toLimit(limit);
    return this.service.listObjects(disk, {
      ...(prefix ? { prefix } : {}),
      ...(cursor ? { cursor } : {}),
      ...(limitValue !== undefined ? { limit: limitValue } : {}),
    });
  }

  @Get('disks/:disk/object')
  object(@Param('disk') disk: string, @Query('key') key: string): Promise<ObjectDetailResponse> {
    return this.service.objectDetail(disk, key);
  }

  /** Streams the object's bytes inline (Content-Disposition: inline) from the same origin, so the SPA
   *  can render text/PDF previews the browser would otherwise download, and read text past CORS. */
  @Get('disks/:disk/object/raw')
  async objectRaw(@Param('disk') disk: string, @Query('key') key: string): Promise<StreamableFile> {
    const { stream, contentType, size } = await this.service.objectStream(disk, key);
    return new StreamableFile(stream, {
      type: contentType,
      disposition: 'inline',
      ...(Number.isFinite(size) ? { length: size } : {}),
    });
  }

  @Get('uploads')
  uploads(
    @Query('disk') disk?: string,
    @Query('prefix') prefix?: string,
  ): Promise<UploadListResponse> {
    return this.service.listUploads({
      ...(disk ? { disk } : {}),
      ...(prefix ? { prefix } : {}),
    });
  }

  @Get('uploads/:id')
  upload(@Param('id') id: string): Promise<UploadDetailResponse> {
    return this.service.uploadDetail(id);
  }

  @Get('library/collections')
  collections(): Promise<CollectionsResponse> {
    return this.service.listCollections();
  }

  @Get('library')
  library(
    @Query('collection') collection?: string,
    @Query('disk') disk?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<LibraryListResponse> {
    const limitValue = toLimit(limit);
    return this.service.listLibrary({
      ...(collection ? { collection } : {}),
      ...(disk ? { disk } : {}),
      ...(cursor ? { cursor } : {}),
      ...(limitValue !== undefined ? { limit: limitValue } : {}),
    });
  }

  @Get('library/:id')
  libraryRecord(@Param('id') id: string): Promise<LibraryDetailResponse> {
    return this.service.libraryDetail(id);
  }

  @Get('topology')
  topology(): Topology {
    return this.service.topology();
  }
}
