import { describe, expect, it } from 'vitest';
import { attachmentDisposition, downloadFilename } from './content-disposition.js';

describe('downloadFilename', () => {
  it('takes the last segment of a key', () => {
    expect(downloadFilename('reports/2026/q1.csv')).toBe('q1.csv');
    expect(downloadFilename('q1.csv')).toBe('q1.csv');
  });

  it('falls back for a key that names no file', () => {
    // A folder marker (the zero-byte key `createFolder` writes) has no last segment.
    expect(downloadFilename('reports/2026/')).toBe('download');
    expect(downloadFilename('')).toBe('download');
    expect(downloadFilename('   ')).toBe('download');
  });
});

describe('attachmentDisposition', () => {
  it('quotes a plain ASCII name and repeats it as the encoded form', () => {
    expect(attachmentDisposition('q1.csv')).toBe(
      `attachment; filename="q1.csv"; filename*=UTF-8''q1.csv`,
    );
  });

  it('percent-encodes a space in the encoded form while leaving the quoted one readable', () => {
    expect(attachmentDisposition('fleet posture.xlsx')).toBe(
      `attachment; filename="fleet posture.xlsx"; filename*=UTF-8''fleet%20posture.xlsx`,
    );
  });

  it('carries non-ASCII in filename* and degrades the ASCII fallback', () => {
    // The quoted form is a header field value: it cannot hold these bytes at all, so the fallback
    // keeps only what ASCII can say and `filename*` carries the real name.
    expect(attachmentDisposition('relatório.pdf')).toBe(
      `attachment; filename="relatrio.pdf"; filename*=UTF-8''relat%C3%B3rio.pdf`,
    );
  });

  it('encodes the characters encodeURIComponent leaves behind', () => {
    // `'`, `(`, `)` and `*` are NOT RFC 5987 attr-chars; a bare `'` would close the ext-value early
    // and truncate the name. `!` is an attr-char and stays as-is.
    expect(attachmentDisposition(`o'brien (final)*!.txt`)).toBe(
      `attachment; filename="o'brien (final)*!.txt"; filename*=UTF-8''o%27brien%20%28final%29%2A!.txt`,
    );
  });

  it('strips what would break out of the quoted string', () => {
    // A `"` or a `\` in the quoted form lets a crafted key forge further header parameters.
    expect(attachmentDisposition('sa"y\\hi.txt')).toBe(
      `attachment; filename="sayhi.txt"; filename*=UTF-8''sa%22y%5Chi.txt`,
    );
  });

  it('strips control characters, which would otherwise forge a header break', () => {
    expect(attachmentDisposition('a\r\nX-Evil: 1.txt')).toBe(
      `attachment; filename="aX-Evil: 1.txt"; filename*=UTF-8''a%0D%0AX-Evil%3A%201.txt`,
    );
  });

  it('falls back when the name is blank, in both forms', () => {
    for (const blank of ['', '   ']) {
      expect(attachmentDisposition(blank)).toBe(
        `attachment; filename="download"; filename*=UTF-8''download`,
      );
    }
  });

  it('falls back for the quoted form alone when nothing ASCII survives', () => {
    expect(attachmentDisposition('日報')).toBe(
      `attachment; filename="download"; filename*=UTF-8''%E6%97%A5%E5%A0%B1`,
    );
  });
});
