import type { ObjectDetailResponse } from '../../client/types.js';

/** An object opened in the preview lightbox: the detail (signed `url`, size, type) plus the disk and
 *  display name from the row it was opened from. `disk` is what lets a renderer read the bytes back
 *  through the same-origin proxy — inline, range-capable, and past CORS. */
export interface PreviewItem extends ObjectDetailResponse {
  disk: string;
  name: string;
}
