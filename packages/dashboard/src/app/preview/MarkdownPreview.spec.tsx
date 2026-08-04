// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './MarkdownPreview.js';

/** Parse the renderer's output back into nodes so assertions read the DOM the browser would build,
 *  not a substring of a string — `innerHTML` is where an attribute that survived and an attribute
 *  that was escaped into text look identical. */
function parse(markdown: string): HTMLDivElement {
  const host = document.createElement('div');
  host.innerHTML = renderMarkdown(markdown);
  return host;
}

describe('renderMarkdown', () => {
  describe('sanitization', () => {
    // The reason this renderer exists in this shape. Markdown passes raw HTML through by design, and
    // the bytes came out of a bucket anyone with upload rights can write to, so a README is an XSS
    // vector into the console unless the sanitizer runs on every single render.
    it('drops a <script> block written into the markdown', () => {
      const html = renderMarkdown('# Title\n\n<script>window.pwned = true;</script>\n');
      expect(html).not.toContain('<script');
      expect(
        parse('# Title\n\n<script>window.pwned = true;</script>\n').querySelector('script'),
      ).toBeNull();
    });

    it('strips an onerror handler off an inline <img>', () => {
      const host = parse('Look: <img src="x" onerror="window.pwned = true">\n');
      const image = host.querySelector('img');
      expect(image).not.toBeNull();
      expect(image?.hasAttribute('onerror')).toBe(false);
      expect(host.innerHTML).not.toContain('onerror');
    });

    it('strips a javascript: link target', () => {
      const anchor = parse('[click me](javascript:window.pwned=true)').querySelector('a');
      // DOMPurify either drops the anchor or empties the href; either way nothing scriptable is left.
      expect(anchor?.getAttribute('href') ?? '').not.toContain('javascript:');
    });

    it('strips event handlers and <script> smuggled in through a raw HTML block', () => {
      const host = parse('<div onclick="window.pwned = true"><script>1</script>ok</div>');
      expect(host.querySelector('script')).toBeNull();
      expect(host.querySelector('div')?.hasAttribute('onclick')).toBe(false);
    });
  });

  describe('rendering', () => {
    it('renders headings, lists, emphasis and code', () => {
      const host = parse('# Run report\n\n- one\n- **two**\n\n`inline`\n');
      expect(host.querySelector('h1')?.textContent).toBe('Run report');
      expect(host.querySelectorAll('li')).toHaveLength(2);
      expect(host.querySelector('strong')?.textContent).toBe('two');
      expect(host.querySelector('code')?.textContent).toBe('inline');
    });

    it('renders GFM tables (data dictionaries are mostly tables)', () => {
      const host = parse('| col | type |\n| --- | ---- |\n| id | int |\n');
      expect(host.querySelector('th')?.textContent).toBe('col');
      expect(host.querySelectorAll('tbody td')).toHaveLength(2);
    });

    it('renders fenced code blocks as a <pre>', () => {
      expect(parse('```sh\nls -la\n```\n').querySelector('pre code')?.textContent).toContain(
        'ls -la',
      );
    });
  });

  describe('links', () => {
    it('opens links in a new tab without handing over window.opener', () => {
      const anchor = parse('[docs](https://example.com/docs)').querySelector('a');
      expect(anchor?.getAttribute('target')).toBe('_blank');
      expect(anchor?.getAttribute('rel')).toBe('noopener noreferrer');
    });

    it('leaves a relative link target exactly as written rather than guessing at it', () => {
      const anchor = parse('[sibling](./OTHER.md)').querySelector('a');
      expect(anchor?.getAttribute('href')).toBe('./OTHER.md');
    });

    it('leaves a relative image source alone', () => {
      const image = parse('![diagram](./docs/diagram.png)').querySelector('img');
      expect(image?.getAttribute('src')).toBe('./docs/diagram.png');
    });
  });

  it('renders empty input as empty output', () => {
    expect(renderMarkdown('')).toBe('');
  });
});
