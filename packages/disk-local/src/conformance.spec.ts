import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runStorageDriverConformance } from '@dudousxd/nestjs-media-testing';
import { LocalDriver } from './local-driver';

runStorageDriverConformance(
  'LocalDriver',
  () => new LocalDriver({ root: mkdtempSync(join(tmpdir(), 'conf-')) }),
);
