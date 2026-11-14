import type { SVGProps } from 'react';

/**
 * The media console's own 16px nav glyphs, drawn like the kit's (`aviary-kit/icons.tsx`): stroke
 * paths in currentColor on a 16×16 grid.
 */
type IconProps = SVGProps<SVGSVGElement>;

function Glyph({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

/** Library: a framed picture. */
export function ImageIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
      <circle cx="6" cy="6.5" r="1.2" />
      <path d="m14 11-3.5-3.5L4 13.5" />
    </Glyph>
  );
}

/** Collections: stacked layers. */
export function LayersIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M8 2 14 5 8 8 2 5z" />
      <path d="m2 8 6 3 6-3" />
      <path d="m2 11 6 3 6-3" />
    </Glyph>
  );
}

/** Uploads: an arrow rising out of a tray. */
export function UploadIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M8 10.5V2.5M5 5.5l3-3 3 3" />
      <path d="M2.5 10v2a1.5 1.5 0 0 0 1.5 1.5h8a1.5 1.5 0 0 0 1.5-1.5v-2" />
    </Glyph>
  );
}

/** Disks: a storage drive. */
export function DiskIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <ellipse cx="8" cy="4" rx="5.5" ry="2" />
      <path d="M2.5 4v8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2V4" />
      <path d="M2.5 8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2" />
    </Glyph>
  );
}
