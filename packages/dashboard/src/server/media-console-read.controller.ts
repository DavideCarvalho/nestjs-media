import {
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Query,
  Res,
  StreamableFile,
  UseGuards,
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
import { MediaConsoleGuard } from './media-console.guard.js';
import {
  MediaConsoleService,
  RangeNotSatisfiableException,
  type RequestedReadRange,
} from './media-console.service.js';
import type { ObjectInsightsResponse } from './object-insights.js';

/** Parse an optional numeric query param; undefined when absent or not a finite number. */
function toLimit(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

/** `bytes=<start>-<end>`, `bytes=<start>-`, or the suffix `bytes=-<n>`. Nothing else: a multi-range
 *  request, a non-`bytes` unit, or junk fails to match and is treated as absent. */
const SINGLE_BYTE_RANGE = /^bytes=(\d*)-(\d*)$/;

/**
 * Parse a `Range` request header into something the service can resolve against the object's size.
 *
 * Returns `null` for "no usable range", which the caller treats as no range at all — a full 200
 * body. That is deliberate and RFC 9110-sanctioned: "An origin server MUST ignore a Range header
 * field that contains a range unit it does not understand", and a server may likewise ignore one it
 * cannot parse. Ignoring is safe (the client gets everything it asked for and more); guessing is
 * not, which is why anything outside the single-range grammar above is rejected wholesale rather
 * than partially interpreted.
 */
export function parseRangeHeader(header: string | undefined): RequestedReadRange | null {
  if (header === undefined) return null;
  const match = SINGLE_BYTE_RANGE.exec(header.trim());
  if (!match) return null;
  const startText = match[1] ?? '';
  const endText = match[2] ?? '';
  // `bytes=-` names neither bound — meaningless, not a range.
  if (startText === '' && endText === '') return null;
  // `bytes=-N` — the LAST n bytes. Only the size tells us where that starts, so it travels as a
  // suffix and the service (which has the stat) makes it absolute.
  if (startText === '') return { suffixLength: Number(endText) };
  const start = Number(startText);
  return endText === '' ? { start } : { start, end: Number(endText) };
}

/** The response surface this controller drives, structurally typed: Express' response and Fastify's
 *  reply both expose `status()`, and both reach the Node response for `setHeader` (Fastify via
 *  `.raw`). Keeps the package free of a platform-specific type dependency, like `auth/response.ts`. */
interface ConsoleHttpResponse {
  status?(code: number): unknown;
  statusCode?: number;
  setHeader?(name: string, value: string): unknown;
  raw?: { statusCode?: number; setHeader?(name: string, value: string): unknown };
}

function setHeader(response: ConsoleHttpResponse, name: string, value: string): void {
  if (typeof response.setHeader === 'function') {
    response.setHeader(name, value);
    return;
  }
  if (typeof response.raw?.setHeader === 'function') response.raw.setHeader(name, value);
}

/** Set the response status without ending the response — Nest still pipes the `StreamableFile`
 *  afterwards, and (with `passthrough`) does not re-apply the route's default 200 over this. */
function setStatus(response: ConsoleHttpResponse, code: number): void {
  if (typeof response.status === 'function') {
    response.status(code);
    return;
  }
  if (response.raw) response.raw.statusCode = code;
  else response.statusCode = code;
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
   * Streams the object's bytes inline (Content-Disposition: inline) from the same origin, so the SPA
   * can render text/PDF previews the browser would otherwise download, and read text past CORS.
   *
   * Honours a single-range `Range` header, which is what lets a reader pull a few KB out of a
   * multi-hundred-MB object (a SQLite page, a ZIP's central directory) instead of the whole file.
   * With no `Range` the response is byte-for-byte what it always was — a plain 200 full body, which
   * the PDF/text/spreadsheet previews depend on.
   */
  @Get('disks/:disk/object/raw')
  async objectRaw(
    @Param('disk') disk: string,
    @Query('key') key: string,
    @Headers('range') rangeHeader: string | undefined,
    @Res({ passthrough: true }) response: ConsoleHttpResponse,
  ): Promise<StreamableFile> {
    const requested = parseRangeHeader(rangeHeader);
    // On EVERY response, 200 included: `Accept-Ranges` is how a client discovers that ranged reads
    // work here at all. A client that can't tell will either not try, or try and mis-handle a 200.
    setHeader(response, 'Accept-Ranges', 'bytes');

    let result: Awaited<ReturnType<MediaConsoleService['objectStream']>>;
    try {
      result = await this.service.objectStream(disk, key, requested ?? undefined);
    } catch (error) {
      // RFC 9110 requires the 416 to name the object's real size so the client can re-ask. Nest's
      // exception filter serializes the body but cannot know the size, so the header goes on here,
      // before the rethrow — headers already on the response survive the filter's `status().json()`.
      if (error instanceof RangeNotSatisfiableException) {
        setHeader(response, 'Content-Range', `bytes */${error.size}`);
      }
      throw error;
    }

    const { stream, contentType, size, range } = result;
    if (!range) {
      return new StreamableFile(stream, {
        type: contentType,
        disposition: 'inline',
        ...(Number.isFinite(size) ? { length: size } : {}),
      });
    }
    setStatus(response, 206);
    setHeader(response, 'Content-Range', `bytes ${range.start}-${range.end}/${size}`);
    // Content-Length is the SLICE's length, not the object's — inclusive bounds, hence the +1.
    return new StreamableFile(stream, {
      type: contentType,
      disposition: 'inline',
      length: range.end - range.start + 1,
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
