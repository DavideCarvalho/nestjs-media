import { MAX_FOLDER_LISTING_LIMIT } from '@dudousxd/nestjs-media-core';
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
import { ListQueryError, parseCursorParams, parseFilterParams } from './list-api.js';
import { MediaConsoleService } from './media-console.service.js';
import type { ObjectInsightsResponse } from './object-insights.js';

type ListQuery = Record<string, unknown>;

/** Page size of the cursor-paged lists when the request sends no `first`. */
const DEFAULT_PAGE_SIZE = 50;
/** Largest `first` on `library`; bigger values are clamped. */
const MAX_LIBRARY_PAGE_SIZE = 200;

/**
 * `after` + `first` for a forward-only list (object-store continuation tokens, the store's keyset):
 * `before`/`last` paging backward is a 400, since no store here can serve it.
 */
function forwardPage(query: ListQuery, maxSize: number): { cursor?: string; limit: number } {
  const { after, size, backward } = parseCursorParams(query, {
    defaultSize: DEFAULT_PAGE_SIZE,
    maxSize,
  });
  if (backward)
    throw new ListQueryError('This list pages forward only: use "after", not "before".');
  return { ...(after !== undefined ? { cursor: after } : {}), limit: size };
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

  /**
   * One folder level, cursor-paged (`after` + `first`, at most 1000). `prefix` is the folder being
   * listed — part of the resource, like the disk, not a filter: it decides which `folders` come
   * back. A cursor no previous page returned is a 400.
   */
  @Get('disks/:disk/objects')
  objects(@Param('disk') disk: string, @Query() query: ListQuery): Promise<ObjectListResponse> {
    const prefix = query.prefix;
    if (prefix !== undefined && typeof prefix !== 'string') {
      throw new ListQueryError('Invalid "prefix": expected a single folder path.');
    }
    return this.service.listObjects(disk, {
      ...(prefix ? { prefix } : {}),
      ...forwardPage(query, MAX_FOLDER_LISTING_LIMIT),
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

  /** Upload sessions in progress, unpaged. Filters: `filter[disk]`, `filter[key][startsWith]`. */
  @Get('uploads')
  uploads(@Query() query: ListQuery): Promise<UploadListResponse> {
    let disk: string | undefined;
    let prefix: string | undefined;
    for (const { field, value } of parseFilterParams(query, {
      fields: { disk: ['eq'], key: ['startsWith'] },
    })) {
      if (field === 'disk') disk = value as string;
      else prefix = value as string;
    }
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

  /**
   * Media records in the store's one order, `(createdAt, id)` ascending, cursor-paged (`after` +
   * `first`, at most 200). Filters: `filter[collection]`, `filter[disk]`.
   */
  @Get('library')
  library(@Query() query: ListQuery): Promise<LibraryListResponse> {
    const filter: { collection?: string; disk?: string } = {};
    for (const { field, value } of parseFilterParams(query, {
      fields: { collection: ['eq'], disk: ['eq'] },
    })) {
      filter[field] = value as string;
    }
    return this.service.listLibrary({ ...filter, ...forwardPage(query, MAX_LIBRARY_PAGE_SIZE) });
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
