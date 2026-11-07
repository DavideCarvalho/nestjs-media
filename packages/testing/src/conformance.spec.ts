import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryDisk, LocalDisk } from '@nestjs/storage';
import { describeMediaDiskConformance } from './conformance';

describeMediaDiskConformance('InMemoryDisk', () => new InMemoryDisk());

const local = new LocalDisk({ root: mkdtempSync(join(tmpdir(), 'media-conformance-')) });
describeMediaDiskConformance('LocalDisk', () => local);
