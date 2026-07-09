import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Topology } from '../client/types.js';
import { App } from './App.js';
import './styles.css';

// Standalone visual-verification entry: no backend. A tiny fetch stub answers the console's JSON
// API with fixtures so the shell + views render for a design review. Wave 3 expands the fixtures
// to exercise every view (disks/objects, live uploads, library records + variants).
const TOPOLOGY: Topology = { hasStore: true, hasUploads: true, disks: 3, actions: true };

const FIXTURES: Record<string, unknown> = {
  '/topology': TOPOLOGY,
  '/disks': { disks: [] },
  '/uploads': { uploads: [] },
  '/library/collections': { collections: [] },
  '/library': { records: [] },
};

const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  for (const [path, body] of Object.entries(FIXTURES)) {
    if (url.endsWith(path)) {
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
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
