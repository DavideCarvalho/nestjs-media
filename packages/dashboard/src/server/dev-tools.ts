import {
  type ExecutionContext,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
  Optional,
} from '@nestjs/common';
import { CONSOLE_AUTHORIZE_DECIDE, type ConsoleDecide } from './console-authorize.js';
import { MediaConsoleService } from './media-console.service.js';
import { MEDIA_DASHBOARD_ACTIONS, MEDIA_DASHBOARD_DEV_TOOLS } from './tokens.js';

// ── the dev-tools contract (v1), re-declared: this package never imports the agent's MCP server ──

/** The process-wide slot `@dudousxd/nestjs-agent-mcp-server` serves on its dev MCP endpoint. */
export const DEV_TOOLS_SLOT: symbol = Symbol.for('@dudousxd/aviary:dev-tools');

/** One property of a {@link DevToolInputSchema}. */
export interface DevToolInputProperty {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array';
  description?: string;
  enum?: readonly string[];
  /** Arrays hold strings only. */
  items?: { type: 'string' };
  minimum?: number;
  maximum?: number;
}

/** An object of scalar / enum / array-of-string properties. */
export interface DevToolInputSchema {
  type: 'object';
  properties: Record<string, DevToolInputProperty>;
  required?: string[];
}

/** What the slot's `authorize` answers: the console's resolved decision. */
export type DevToolsDecision =
  | { allowed: true; caller?: string }
  | { allowed: false; reason: 'unauthenticated' | 'forbidden'; redirectTo?: string };

/** What a tool's `run` receives besides its input. */
export interface DevToolCall {
  context: ExecutionContext;
  caller: { id: string; via: 'token' | 'session' | 'open' };
  limits: { maxRows: number; maxBytes: number };
}

/** One developer tool, as the dev-tools slot takes it. */
export interface MediaDevTool {
  /** `media_<verb>_<noun>`. */
  name: string;
  /** `read` tools are listed by default; `action` tools only when the app opts in. */
  kind: 'read' | 'action';
  description: string;
  input: DevToolInputSchema;
  /** Set on actions that delete. */
  destructive?: boolean;
  /** Capability, not access: hides a tool this deployment cannot run. */
  available?(): boolean | Promise<boolean>;
  run(input: Record<string, unknown>, call?: DevToolCall): Promise<unknown>;
}

interface DevToolsLib {
  lib: string;
  title: string;
  authorize(context: ExecutionContext): Promise<DevToolsDecision>;
  tools: MediaDevTool[];
}

interface DevToolsSlot {
  readonly version: 1;
  readonly libs: DevToolsLib[];
  register(lib: DevToolsLib): () => void;
}

/** The slot, created when absent (whoever loads first creates it). */
function devToolsSlot(): Partial<DevToolsSlot> {
  const holder = globalThis as Record<symbol, unknown>;
  const existing = holder[DEV_TOOLS_SLOT] as Partial<DevToolsSlot> | undefined;
  if (existing !== undefined) return existing;
  const libs: DevToolsLib[] = [];
  const slot: DevToolsSlot = {
    version: 1,
    libs,
    register(lib) {
      if (libs.some((entry) => entry.lib === lib.lib)) {
        throw new Error(`dev tools: the lib "${lib.lib}" is already registered`);
      }
      libs.push(lib);
      return () => {
        const index = libs.indexOf(lib);
        if (index !== -1) libs.splice(index, 1);
      };
    },
  };
  holder[DEV_TOOLS_SLOT] = slot;
  return slot;
}

// ── the media tools ──────────────────────────────────────────────────────────

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
/** Keys `media_delete_objects` deletes at most per call. */
export const MAX_DELETE_KEYS = 100;

const limit: DevToolInputProperty = {
  type: 'integer',
  description: `Rows per page (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}).`,
  minimum: 1,
  maximum: MAX_LIMIT,
};
const cursor: DevToolInputProperty = {
  type: 'string',
  description: 'Pass the `next` of the previous page.',
};
const disk: DevToolInputProperty = { type: 'string', description: 'Disk name.' };

const str = (value: unknown) => (typeof value === 'string' && value !== '' ? value : undefined);

function limitOf(input: Record<string, unknown>): number {
  const value = input.limit;
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? Math.min(value, MAX_LIMIT)
    : DEFAULT_LIMIT;
}

function required(input: Record<string, unknown>, key: string): string {
  const value = str(input[key]);
  if (value === undefined) throw new Error(`"${key}" is required`);
  return value;
}

/** Only the fields that were given (`exactOptionalPropertyTypes`). */
function given<T extends Record<string, string | number | undefined>>(fields: T) {
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>;
  };
}

/**
 * Runs a console call, turning its HTTP errors into plain errors (the endpoint answers a throw as an
 * MCP `isError` result): a 404 reads `<what> not found`, a 400 keeps its message.
 */
async function call<T>(what: () => string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    // Keep the console's own reason (e.g. "Unknown disk: nope") next to what was asked for.
    if (error instanceof NotFoundException)
      throw new Error(`${what()} not found (${error.message})`);
    if (error instanceof HttpException) throw new Error(error.message);
    throw error;
  }
}

/**
 * The media developer tools (lib `media`): the console's reads and two of its actions, through the
 * same {@link MediaConsoleService} methods its API serves, so the app's tenancy applies. Signed
 * object URLs are never returned. The actions are available only when the console's `actions` are
 * on.
 */
export function mediaDevTools(
  service: MediaConsoleService,
  options: { actions?: boolean } = {},
): MediaDevTool[] {
  const actions = () => options.actions === true;
  return [
    {
      name: 'media_list_disks',
      kind: 'read',
      description:
        'The configured storage disks: name, whether it is the default, and capabilities (presign, multipart, public URLs). Returns { items, next }.',
      input: { type: 'object', properties: {} },
      async run() {
        const { data: disks } = await service.listDisks();
        return { items: disks, next: null };
      },
    },
    {
      name: 'media_list_objects',
      kind: 'read',
      description:
        'One folder level of a disk: `folders` (name, prefix) and `items` (key, name, sizeBytes, lastModified). Filters: prefix (a folder, e.g. "avatars/"). Returns { folders, items, next }; pass next as cursor.',
      input: {
        type: 'object',
        properties: {
          disk,
          prefix: { type: 'string', description: 'Folder to list (default the root).' },
          cursor,
          limit,
        },
        required: ['disk'],
      },
      async run(input) {
        const name = required(input, 'disk');
        const level = await call(
          () => `disk "${name}"`,
          () =>
            service.listObjects(
              name,
              given({
                prefix: str(input.prefix),
                cursor: str(input.cursor),
                limit: limitOf(input),
              }),
            ),
        );
        return { folders: level.folders, items: level.data, next: level.meta.nextCursor };
      },
    },
    {
      name: 'media_get_object',
      kind: 'read',
      description:
        "One object's metadata (key, size, contentType, lastModified) and what the app knows about it (insights). No URL. An error when the disk or the key does not exist.",
      input: {
        type: 'object',
        properties: { disk, key: { type: 'string', description: 'Object key.' } },
        required: ['disk', 'key'],
      },
      async run(input) {
        const name = required(input, 'disk');
        const key = required(input, 'key');
        const what = () => `object "${key}" on disk "${name}"`;
        const { url: _url, ...object } = await call(what, () => service.objectDetail(name, key));
        const { insights } = await call(what, () => service.objectInsights(name, key));
        return { ...object, insights };
      },
    },
    {
      name: 'media_list_uploads',
      kind: 'read',
      description:
        'Resumable upload sessions in progress: id, disk, key, offset, size, percent, parts. Filters: disk, prefix (key prefix). Returns { items, next }; pass `next` back as `cursor` for the following page.',
      input: {
        type: 'object',
        properties: {
          disk,
          prefix: { type: 'string', description: 'Key prefix.' },
          cursor: { type: 'string', description: 'The `next` of the previous page.' },
          limit,
        },
      },
      async run(input) {
        const { data: uploads } = await service.listUploads(
          given({ disk: str(input.disk), prefix: str(input.prefix) }),
        );
        const cursor = str(input.cursor);
        if (cursor !== undefined && !/^\d+$/.test(cursor)) {
          throw new Error(`"cursor" must be the \`next\` of a previous page, got "${cursor}"`);
        }
        const start = cursor === undefined ? 0 : Number(cursor);
        const end = start + limitOf(input);
        return {
          items: uploads.slice(start, end),
          next: end < uploads.length ? String(end) : null,
        };
      },
    },
    {
      name: 'media_get_upload',
      kind: 'read',
      description:
        'One upload session and its received parts. An error when no session has that id.',
      input: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Upload session id.' } },
        required: ['id'],
      },
      async run(input) {
        const id = required(input, 'id');
        return call(
          () => `upload ${id}`,
          () => service.uploadDetail(id),
        );
      },
    },
    {
      name: 'media_list_collections',
      kind: 'read',
      description:
        'The media library. Without `collection`: every collection with its record count and total bytes, as { items, next: null }. With `collection` (and optionally disk): its records (id, owner, name, fileName, mimeType, size, disk, path), newest first, as { items, next }; pass next as cursor.',
      input: {
        type: 'object',
        properties: {
          collection: { type: 'string', description: 'Collection name.' },
          disk,
          cursor,
          limit,
        },
      },
      async run(input) {
        const collection = str(input.collection);
        if (collection === undefined && str(input.disk) === undefined) {
          const { data: collections } = await service.listCollections();
          return { items: collections, next: null };
        }
        const page = await service.listLibrary(
          given({
            collection,
            disk: str(input.disk),
            cursor: str(input.cursor),
            limit: limitOf(input),
          }),
        );
        return { items: page.data, next: page.meta.nextCursor };
      },
    },
    {
      name: 'media_get_media',
      kind: 'read',
      description:
        'One media library record and its variants (name, disk, path; no URL). An error when no record has that id.',
      input: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Media record id.' } },
        required: ['id'],
      },
      async run(input) {
        const id = required(input, 'id');
        const detail = await call(
          () => `media ${id}`,
          () => service.libraryDetail(id),
        );
        return {
          record: detail.record,
          variants: detail.variants.map(({ url: _url, ...variant }) => variant),
        };
      },
    },
    {
      name: 'media_abort_upload',
      kind: 'action',
      description:
        'Cancels a resumable upload session: removes its record so it stops showing as in progress. A native multipart upload is left to the bucket lifecycle. An error when no session has that id.',
      input: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Upload session id.' } },
        required: ['id'],
      },
      available: actions,
      async run(input) {
        const id = required(input, 'id');
        const what = () => `upload ${id}`;
        // The console's abort is a no-op for a missing id; a tool answers "not found" instead.
        await call(what, () => service.uploadDetail(id));
        await call(what, () => service.abortUpload(id));
        return { aborted: id };
      },
    },
    {
      name: 'media_delete_objects',
      kind: 'action',
      destructive: true,
      description: `Deletes objects from a disk by key, at most ${MAX_DELETE_KEYS} per call. Returns { deleted } with the keys deleted. Deleting is idempotent: a key that does not exist is reported as deleted. Stops at the first key that fails and returns { deleted, failed: { key, error }, skipped } so you know exactly what was applied. An error when the disk does not exist.`,
      input: {
        type: 'object',
        properties: {
          disk,
          keys: {
            type: 'array',
            items: { type: 'string' },
            description: `Object keys (1 to ${MAX_DELETE_KEYS}).`,
          },
        },
        required: ['disk', 'keys'],
      },
      available: actions,
      async run(input) {
        const name = required(input, 'disk');
        const keys = Array.isArray(input.keys)
          ? input.keys.filter((key): key is string => typeof key === 'string' && key !== '')
          : [];
        if (keys.length === 0) throw new Error('"keys" must list at least one key');
        if (keys.length > MAX_DELETE_KEYS) {
          throw new Error(`"keys" lists ${keys.length} keys; at most ${MAX_DELETE_KEYS} per call`);
        }
        const deleted: string[] = [];
        for (const [index, key] of keys.entries()) {
          try {
            await call(
              () => `disk "${name}"`,
              () => service.deleteObject(name, key),
            );
          } catch (error) {
            // An unknown disk fails before anything is deleted: keep that an error.
            if (deleted.length === 0 && index === 0) throw error;
            return {
              deleted,
              failed: { key, error: error instanceof Error ? error.message : String(error) },
              skipped: keys.slice(index + 1),
            };
          }
          deleted.push(key);
        }
        return { deleted };
      },
    },
  ];
}

const logger = new Logger('MediaDashboardModule');

/**
 * Registers the media tools into the dev-tools slot, gated by the console's own resolved
 * `authorize`, when the console is mounted (or `devTools: true`). Removed again on shutdown.
 */
@Injectable()
export class MediaDevToolsRegistration implements OnModuleInit, OnModuleDestroy {
  #unregister: (() => void) | undefined;

  constructor(
    @Inject(MEDIA_DASHBOARD_DEV_TOOLS) private readonly enabled: boolean,
    @Inject(MediaConsoleService) private readonly service: MediaConsoleService,
    @Inject(CONSOLE_AUTHORIZE_DECIDE) private readonly decide: ConsoleDecide,
    @Optional() @Inject(MEDIA_DASHBOARD_ACTIONS) private readonly actions: boolean | null = null,
  ) {}

  onModuleInit(): void {
    if (!this.enabled) return;
    const slot = devToolsSlot();
    if (slot.version !== 1 || typeof slot.register !== 'function') return;
    try {
      this.#unregister = slot.register({
        lib: 'media',
        title: 'Media',
        authorize: (context) => this.decide(context),
        tools: mediaDevTools(this.service, { actions: this.actions === true }),
      });
    } catch (error) {
      // Another application in this process registered the media tools: keep the console up.
      logger.warn(
        `media dev tools not registered: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  onModuleDestroy(): void {
    this.#unregister?.();
    this.#unregister = undefined;
  }
}
