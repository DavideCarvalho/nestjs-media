import { runMediaStoreConformance } from '@dudousxd/nestjs-media-testing';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { DrizzleMediaStore, createMediaTable } from './drizzle-media-store';

runMediaStoreConformance('DrizzleMediaStore (sqlite)', () => {
  const db = drizzle(new Database(':memory:'));
  createMediaTable(db);
  return new DrizzleMediaStore(db);
});
