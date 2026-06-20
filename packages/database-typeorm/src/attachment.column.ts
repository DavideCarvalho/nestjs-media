import { Attachment, type AttachmentData } from '@dudousxd/nestjs-media-core';
import { Column, type ColumnOptions, type ValueTransformer } from 'typeorm';

/** TypeORM transformer that (de)serializes an Attachment to/from a JSON column. */
export const attachmentTransformer: ValueTransformer = {
  to: (value: Attachment | null | undefined) => (value ? value.toJSON() : null),
  from: (value: AttachmentData | null | undefined) => Attachment.fromJSON(value ?? null),
};

/**
 * Column decorator for an Attachment value: `@AttachmentColumn() avatar: Attachment | null`.
 * Stores as a portable JSON column and rehydrates to an `Attachment` on read.
 */
export function AttachmentColumn(options: ColumnOptions = {}): PropertyDecorator {
  return Column({
    type: 'simple-json',
    nullable: true,
    transformer: attachmentTransformer,
    ...options,
  });
}
