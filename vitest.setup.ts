import 'reflect-metadata';
import { afterEach } from 'vitest';

// The console keeps view state in the URL hash (`#/disks/d?preview=a.csv&q=paid`). The test
// environment keeps one `location` per file, so reset it after each test: state left by one test
// must not open the next one filtered. (Node-environment specs have no `window`.)
afterEach(() => {
  if (typeof window !== 'undefined') window.history.replaceState(null, '', '/');
});
