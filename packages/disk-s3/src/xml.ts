/** Just enough XML for S3's responses: flat elements, found by name. */
export function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (entity, body: string) => {
    const lower = body.toLowerCase();
    if (lower === 'lt') return '<';
    if (lower === 'gt') return '>';
    if (lower === 'amp') return '&';
    if (lower === 'quot') return '"';
    if (lower === 'apos') return "'";
    const code = lower.startsWith('#x')
      ? Number.parseInt(lower.slice(2), 16)
      : Number(lower.slice(1));
    return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
  });
}

export function encodeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/\r/g, '&#13;');
}

/** The inner XML of every `<tag>` element (`''` for `<tag/>`). */
export function xmlElements(xml: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?(?:/>|>([\\s\\S]*?)</${tag}>)`, 'g');
  for (const match of xml.matchAll(re)) out.push(match[1] ?? '');
  return out;
}

/** The decoded text of the first `<tag>` element. */
export function xmlText(xml: string, tag: string): string | undefined {
  const [first] = xmlElements(xml, tag);
  return first === undefined ? undefined : decodeXml(first);
}
