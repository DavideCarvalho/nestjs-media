import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
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
import { App } from './App.js';
import './styles.css';

// Standalone visual-verification entry: no backend. A fetch stub answers the console's JSON API
// with fixtures so every view renders for a design review — disks with folders and objects, live
// uploads mid-transfer, a library with collections and variants. Populated fixtures are the point:
// an empty console shows none of the surfaces a UI change touches.

const TOPOLOGY: Topology = { hasStore: true, hasUploads: true, disks: 3, actions: true };

const ME = { user: { id: 'u_1', name: 'ops@aviary.dev', roles: ['media:admin'] } };

const DISKS: DiskListResponse = {
  disks: [
    {
      name: 'uploads',
      default: true,
      capabilities: { presign: true, multipart: true, publicUrls: false, list: true },
    },
    {
      name: 'public',
      default: false,
      capabilities: { presign: true, multipart: true, publicUrls: true, list: true },
    },
    {
      name: 'archive',
      default: false,
      capabilities: { presign: false, multipart: false, publicUrls: false, list: true },
    },
  ],
};

/** A tiny inline image so the object preview lightbox renders something real without a backend. */
const SAMPLE_IMAGE = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
     <rect width="640" height="360" fill="#101017"/>
     <circle cx="320" cy="180" r="96" fill="none" stroke="#34d399" stroke-width="3"/>
     <text x="320" y="188" fill="#76767f" font-family="monospace" font-size="20"
           text-anchor="middle">poster.png</text>
   </svg>`,
)}`;

const ROOT_OBJECTS: ObjectListResponse = {
  folders: [
    { name: 'invoices', prefix: 'invoices/' },
    { name: 'avatars', prefix: 'avatars/' },
    { name: 'exports', prefix: 'exports/' },
  ],
  files: [
    {
      key: 'poster.png',
      name: 'poster.png',
      sizeBytes: 2_411_982,
      lastModified: '2026-07-24T09:12:00.000Z',
    },
    {
      key: 'manifest.json',
      name: 'manifest.json',
      sizeBytes: 4_812,
      lastModified: '2026-07-23T18:40:00.000Z',
    },
    {
      key: 'fleet-posture.csv',
      name: 'fleet-posture.csv',
      sizeBytes: 91_233_411,
      lastModified: '2026-07-21T07:02:00.000Z',
    },
  ],
};

const NESTED_OBJECTS: ObjectListResponse = {
  folders: [{ name: '2026-Q3', prefix: 'invoices/2026-Q3/' }],
  files: [
    {
      key: 'invoices/summary.pdf',
      name: 'summary.pdf',
      sizeBytes: 188_402,
      lastModified: '2026-07-19T11:25:00.000Z',
    },
  ],
};

const UPLOADS: UploadListResponse = {
  uploads: [
    {
      id: 'upl_9f2c',
      disk: 'uploads',
      key: 'ingest/2026-07/fleet-posture.csv',
      offset: 68_157_440,
      size: 91_233_411,
      percent: 74,
      parts: 13,
      multipart: true,
      createdAt: new Date(Date.now() - 4 * 60_000).toISOString(),
    },
    {
      id: 'upl_2b71',
      disk: 'archive',
      key: 'backups/2026-07-28.tar.zst',
      offset: 1_073_741_824,
      size: 8_589_934_592,
      percent: 12,
      parts: 4,
      multipart: true,
      createdAt: new Date(Date.now() - 47 * 60_000).toISOString(),
    },
    {
      id: 'upl_c410',
      disk: 'public',
      key: 'brand/hero-loop.mp4',
      offset: 41_943_040,
      size: null,
      percent: null,
      parts: 2,
      multipart: false,
      createdAt: new Date(Date.now() - 90 * 1000).toISOString(),
    },
  ],
};

const UPLOAD_DETAIL: UploadDetailResponse = {
  upload: UPLOADS.uploads[0] as UploadListResponse['uploads'][number],
  parts: [
    { partNumber: 1, etag: '"9b2cf5a1e0d34c7fb0a1"' },
    { partNumber: 2, etag: '"4f1ab77c2e9d10bb63aa"' },
    { partNumber: 3, etag: '"c07e5d3391ba48ff2210"' },
  ],
};

const COLLECTIONS: CollectionsResponse = {
  collections: [
    { key: 'avatars', count: 128, sumSize: 38_112_004 },
    { key: 'documents', count: 41, sumSize: 902_331_004 },
    { key: 'thumbnails', count: 512, sumSize: 12_400_112 },
  ],
};

const LIBRARY: LibraryListResponse = {
  records: [
    {
      id: 'rec_01',
      ownerType: 'User',
      ownerId: '4812',
      collection: 'avatars',
      name: 'avatar',
      fileName: 'avatar-4812.png',
      mimeType: 'image/png',
      size: 184_221,
      disk: 'public',
      path: 'avatars/4812/avatar.png',
      createdAt: '2026-07-22T14:03:00.000Z',
    },
    {
      id: 'rec_02',
      ownerType: 'WorkOrder',
      ownerId: '90211',
      collection: 'documents',
      name: 'signed',
      fileName: 'subwo-90211-signed.pdf',
      mimeType: 'application/pdf',
      size: 2_884_112,
      disk: 'uploads',
      path: 'documents/90211/signed.pdf',
      createdAt: '2026-07-20T08:44:00.000Z',
    },
    {
      id: 'rec_03',
      ownerType: 'Base',
      ownerId: '21',
      collection: 'documents',
      name: 'posture',
      fileName: 'fleet-posture-21.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      size: 41_002_912,
      disk: 'archive',
      path: 'documents/21/posture.xlsx',
      createdAt: '2026-07-18T16:20:00.000Z',
    },
    {
      id: 'rec_04',
      ownerType: 'User',
      ownerId: '77',
      collection: 'thumbnails',
      name: 'thumb',
      fileName: 'hero-loop-thumb.webp',
      mimeType: 'image/webp',
      size: 24_118,
      disk: 'public',
      path: 'thumbnails/77/hero.webp',
      createdAt: '2026-07-17T10:10:00.000Z',
    },
  ],
};

const LIBRARY_DETAIL: LibraryDetailResponse = {
  record: LIBRARY.records[0] as LibraryListResponse['records'][number],
  variants: [
    { name: 'original', url: SAMPLE_IMAGE },
    { name: 'thumb', url: SAMPLE_IMAGE },
  ],
};

const OBJECT_DETAIL: ObjectDetailResponse = {
  key: 'poster.png',
  size: 2_411_982,
  contentType: 'image/svg+xml',
  lastModified: '2026-07-24T09:12:00.000Z',
  url: SAMPLE_IMAGE,
};

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Route a console API request to a fixture. `path` is everything after `/media/api`. */
function fixtureFor(path: string, search: URLSearchParams): Response | undefined {
  if (path === '/me') return json(ME);
  if (path === '/topology') return json(TOPOLOGY);
  if (path === '/disks') return json(DISKS);
  if (path.endsWith('/objects')) {
    return json(search.get('prefix') ? NESTED_OBJECTS : ROOT_OBJECTS);
  }
  if (path.endsWith('/object')) return json(OBJECT_DETAIL);
  if (path === '/uploads') return json(UPLOADS);
  if (path.startsWith('/uploads/')) return json(UPLOAD_DETAIL);
  if (path === '/library/collections') return json(COLLECTIONS);
  if (path === '/library') return json(LIBRARY);
  if (path.startsWith('/library/')) return json(LIBRARY_DETAIL);
  return undefined;
}

const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(href, window.location.origin);
  const marker = '/api';
  const index = url.pathname.indexOf(marker);
  if (index !== -1) {
    const response = fixtureFor(url.pathname.slice(index + marker.length), url.searchParams);
    if (response) return response;
  }
  return originalFetch(input, init);
};

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const container = document.getElementById('root');
if (!container) throw new Error('Missing #root');

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
