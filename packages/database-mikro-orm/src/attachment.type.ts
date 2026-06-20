import { Attachment, type AttachmentData } from '@dudousxd/nestjs-media-core';
import { Type } from '@mikro-orm/core';

/**
 * MikroORM custom type for an Attachment value:
 * `@Property({ type: AttachmentType, nullable: true }) avatar?: Attachment | null`.
 * Stored as JSON, rehydrated to an `Attachment` on load.
 */
export class AttachmentType extends Type<Attachment | null, string | null> {
  override convertToDatabaseValue(value: Attachment | null): string | null {
    return value ? JSON.stringify(value.toJSON()) : null;
  }

  override convertToJSValue(value: string | AttachmentData | null): Attachment | null {
    if (!value) return null;
    const data = typeof value === 'string' ? (JSON.parse(value) as AttachmentData) : value;
    return Attachment.fromJSON(data);
  }

  override getColumnType(): string {
    return 'json';
  }
}
