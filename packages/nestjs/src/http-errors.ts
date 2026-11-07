import { BadRequestException } from '@nestjs/common';

/**
 * A key the client sent that `@nestjs/storage` would refuse (`InvalidMediaKeyError`,
 * `StorageInvalidKeyError`, both `status` 400) is the client's mistake: a 400, not a 500.
 */
export async function clientKeyErrors<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === 'InvalidMediaKeyError' || error.name === 'StorageInvalidKeyError') &&
      (error as { status?: unknown }).status === 400
    ) {
      throw new BadRequestException(error.message);
    }
    throw error;
  }
}
