import {
  Controller,
  Get,
  Inject,
  Param,
  Query,
  Req,
  Res,
  type StreamableFile,
} from '@nestjs/common';
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
import { downloadFilename } from './content-disposition.js';
import { OpenToAuthorization } from './controller-decorators.js';
import { MediaConsoleService } from './media-console.service.js';
import type { ObjectInsightsResponse } from './object-insights.js';

/** Parse an optional numeric query param; undefined when absent or not a finite number. */
function toLimit(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

/**
 * Read-only JSON API for the /media console. Bare `@Controller()` — the path prefix is applied by
 * `RouterModule` (set in `MediaDashboardModule.forRoot({ apiBasePath })`). Always mounted.
 */
// Open to `@nestjs/authorization`'s deny-by-default guard; the console's `authorize` decides access.
@OpenToAuthorization()
@Controller()
export class MediaConsoleReadController {
  constructor(@Inject(MediaConsoleService) private readonly service: MediaConsoleService) {}

  @Get('disks')
  disks(): Promise<DiskListResponse> {
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

  /** What the host knows about this object, from its registered `objectInsights` providers. Empty
   *  when none are registered — the console renders nothing for an empty list. */
  @Get('disks/:disk/object/insights')
  objectInsights(
    @Param('disk') disk: string,
    @Query('key') key: string,
  ): Promise<ObjectInsightsResponse> {
    return this.service.objectInsights(disk, key);
  }

  /**
   * Streams the object's bytes from the same origin (`serveFile()`), so the SPA can render previews
   * past CORS: `inline` for types that can't run script here (images, PDF, audio, video, plain
   * text), `attachment` for the rest — the text previews read the body with `fetch`, which doesn't
   * care. A single `Range` gets a 206, which is how SQLite/ZIP/Parquet previews read a few KB out
   * of a multi-hundred-MB object.
   */
  @Get('disks/:disk/object/raw')
  objectRaw(
    @Param('disk') disk: string,
    @Query('key') key: string,
    @Req() req: unknown,
    @Res({ passthrough: true }) res: unknown,
  ): Promise<StreamableFile | undefined> {
    return this.service.serveObject(disk, key, { req, res, disposition: 'inline' });
  }

  /**
   * The same bytes as `/raw`, but as a SAVE: `Content-Disposition: attachment` with the object's
   * own name. Same-origin and unconditional, so it works where the browser can't reach the store.
   */
  @Get('disks/:disk/object/download')
  objectDownload(
    @Param('disk') disk: string,
    @Query('key') key: string,
    @Req() req: unknown,
    @Res({ passthrough: true }) res: unknown,
  ): Promise<StreamableFile | undefined> {
    return this.service.serveObject(disk, key, {
      req,
      res,
      disposition: 'attachment',
      filename: downloadFilename(key ?? ''),
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
