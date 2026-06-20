import { Attachment, type AttachmentData } from '@dudousxd/nestjs-media-core';
import { customType } from 'drizzle-orm/sqlite-core';

/**
 * Drizzle (sqlite) custom column for an Attachment value:
 * `avatar: attachment('avatar')` → stored as JSON text, rehydrated to an `Attachment`.
 */
export const attachment = customType<{ data: Attachment | null; driverData: string }>({
  dataType() {
    return 'text';
  },
  toDriver(value: Attachment | null): string {
    return JSON.stringify(value ? value.toJSON() : null);
  },
  fromDriver(value: string): Attachment | null {
    return Attachment.fromJSON(value ? (JSON.parse(value) as AttachmentData) : null);
  },
});
