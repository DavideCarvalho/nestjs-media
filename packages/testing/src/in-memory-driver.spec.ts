import { runStorageDriverConformance } from './conformance';
import { InMemoryDriver } from './in-memory-driver';

runStorageDriverConformance('InMemoryDriver', () => new InMemoryDriver());
