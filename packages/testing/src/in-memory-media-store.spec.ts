import { InMemoryMediaStore } from './in-memory-media-store';
import { runMediaStoreConformance } from './media-store-conformance';

runMediaStoreConformance('InMemoryMediaStore', () => new InMemoryMediaStore());
