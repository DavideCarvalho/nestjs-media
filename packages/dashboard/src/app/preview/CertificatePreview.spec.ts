// x509 → tsyringe throws on import without this. The root `vitest.setup.ts` supplies it, but this
// spec is also run directly from the package (`pnpm --filter … exec vitest`), which picks up no root
// config, so it carries its own. Must stay above the x509 import.
import 'reflect-metadata';
import * as x509 from '@peculiar/x509';
import { describe, expect, it } from 'vitest';
import {
  type PemBlock,
  describePemBlock,
  describePemText,
  describeValidity,
  formatFingerprint,
  isPrivateKeyBlock,
  splitPemBlocks,
  validityState,
  validityTone,
} from './CertificatePreview.js';

/** Fixtures are generated here rather than fetched or checked in: a checked-in certificate has a real
 *  expiry date, so the day it passes is the day the expiry assertions below start failing for a reason
 *  that has nothing to do with the code. Generating one lets every date be chosen relative to a fixed
 *  `NOW`. Key generation is P-256, which is milliseconds. */
const NOW = new Date('2026-06-01T12:00:00.000Z');

function daysFromNow(days: number): Date {
  return new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000);
}

async function generateKeys(): Promise<CryptoKeyPair> {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  // `generateKey` is typed as returning either shape; the library ships the guard that narrows it, so
  // use that rather than asserting the type we happen to know we asked for.
  if (!x509.CryptoProvider.isCryptoKeyPair(keys)) throw new Error('expected a key pair');
  return keys;
}

function toBase64(bytes: ArrayBuffer): string {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function armour(label: string, body: string): string {
  const lines = body.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----`;
}

interface Fixture {
  pem: string;
  certificate: x509.X509Certificate;
}

async function selfSigned(options: {
  commonName: string;
  notBefore: Date;
  notAfter: Date;
  dnsNames?: string[];
}): Promise<Fixture> {
  const keys = await generateKeys();
  const altNames: x509.JsonGeneralNames = (options.dnsNames ?? []).map((value) => ({
    type: 'dns',
    value,
  }));
  const certificate = await x509.X509CertificateGenerator.createSelfSigned({
    name: `CN=${options.commonName}, O=Preview Fixtures`,
    serialNumber: '0abc',
    notBefore: options.notBefore,
    notAfter: options.notAfter,
    signingAlgorithm: { name: 'ECDSA', hash: 'SHA-256' },
    keys,
    extensions: altNames.length > 0 ? [new x509.SubjectAlternativeNameExtension(altNames)] : [],
  });
  return { pem: certificate.toString('pem'), certificate };
}

/** A genuine PKCS#8 private key block. The refusal test is only worth anything against real key
 *  material — a placeholder string would pass a `toContain` check that the real thing failed. */
async function privateKeyPem(label = 'PRIVATE KEY'): Promise<{ pem: string; body: string }> {
  const keys = await generateKeys();
  const body = toBase64(await crypto.subtle.exportKey('pkcs8', keys.privateKey));
  return { pem: armour(label, body), body };
}

function rowValue(rows: ReadonlyArray<{ label: string; value: string }>, label: string): string {
  const row = rows.find((candidate) => candidate.label === label);
  if (!row) throw new Error(`no row labelled ${label}`);
  return row.value;
}

describe('splitPemBlocks', () => {
  it('splits a chain into its blocks, in file order', () => {
    const text = [armour('CERTIFICATE', 'QUFB'), armour('CERTIFICATE', 'QkJC')].join('\n');

    expect(splitPemBlocks(text)).toEqual([
      { label: 'CERTIFICATE', body: 'QUFB' },
      { label: 'CERTIFICATE', body: 'QkJC' },
    ]);
  });

  it('labels each block by its own armour in a mixed bundle', () => {
    const text = [
      armour('CERTIFICATE', 'QUFB'),
      armour('RSA PRIVATE KEY', 'QkJC'),
      armour('CERTIFICATE REQUEST', 'Q0ND'),
    ].join('\n');

    expect(splitPemBlocks(text).map((block) => block.label)).toEqual([
      'CERTIFICATE',
      'RSA PRIVATE KEY',
      'CERTIFICATE REQUEST',
    ]);
  });

  it('handles CRLF line endings', () => {
    const text = armour('CERTIFICATE', 'QUFBQkJC').replace(/\n/g, '\r\n');

    expect(splitPemBlocks(text)).toEqual([{ label: 'CERTIFICATE', body: 'QUFBQkJC' }]);
  });

  it('ignores junk before, between and after the armour', () => {
    const text = [
      'Bag Attributes',
      '    friendlyName: leaf',
      'subject=CN = leaf.example.com',
      armour('CERTIFICATE', 'QUFB'),
      '# the intermediate follows',
      armour('CERTIFICATE', 'QkJC'),
      '',
      'trailing junk that is not armour',
      '',
    ].join('\n');

    expect(splitPemBlocks(text).map((block) => block.body)).toEqual(['QUFB', 'QkJC']);
  });

  it('drops a block whose END label does not match its BEGIN label', () => {
    const text = '-----BEGIN CERTIFICATE-----\nQUFB\n-----END X509 CRL-----\n';

    expect(splitPemBlocks(text)).toEqual([]);
  });

  it('returns nothing for a file with no armour at all', () => {
    expect(splitPemBlocks('just some text\n')).toEqual([]);
  });
});

describe('isPrivateKeyBlock', () => {
  it.each([
    'PRIVATE KEY',
    'RSA PRIVATE KEY',
    'EC PRIVATE KEY',
    'DSA PRIVATE KEY',
    'ENCRYPTED PRIVATE KEY',
    'OPENSSH PRIVATE KEY',
  ])('treats %s as key material', (label) => {
    expect(isPrivateKeyBlock(label)).toBe(true);
  });

  it.each(['CERTIFICATE', 'CERTIFICATE REQUEST', 'PUBLIC KEY', 'X509 CRL'])(
    'does not treat %s as key material',
    (label) => {
      expect(isPrivateKeyBlock(label)).toBe(false);
    },
  );
});

describe('private key blocks are never rendered', () => {
  it('describes a real PRIVATE KEY block without carrying any of its bytes', async () => {
    const key = await privateKeyPem();

    const views = await describePemText(key.pem, NOW);

    expect(views).toEqual([{ kind: 'private-key', position: 1, label: 'PRIVATE KEY' }]);
    // Belt and braces: nothing anywhere in the view model — no truncated sample, no fingerprint
    // derived from the key, no error message quoting it — contains any run of the key's base64.
    const serialized = JSON.stringify(views);
    for (let offset = 0; offset + 16 <= key.body.length; offset += 16) {
      expect(serialized).not.toContain(key.body.slice(offset, offset + 16));
    }
  });

  it.each(['RSA PRIVATE KEY', 'EC PRIVATE KEY', 'ENCRYPTED PRIVATE KEY'])(
    'withholds a %s block whatever its payload',
    async (label) => {
      const block: PemBlock = { label, body: 'c2VjcmV0LWtleS1tYXRlcmlhbA==' };

      const view = await describePemBlock(block, 1, NOW);

      expect(view).toEqual({ kind: 'private-key', position: 1, label });
      expect(JSON.stringify(view)).not.toContain('c2VjcmV0');
    },
  );

  it('still renders the certificates in a bundle that also holds a key', async () => {
    const leaf = await selfSigned({
      commonName: 'leaf.example.com',
      notBefore: daysFromNow(-10),
      notAfter: daysFromNow(90),
    });
    const key = await privateKeyPem();
    const ca = await selfSigned({
      commonName: 'Example Root CA',
      notBefore: daysFromNow(-500),
      notAfter: daysFromNow(500),
    });

    const views = await describePemText([leaf.pem, key.pem, ca.pem].join('\n'), NOW);

    expect(views.map((view) => view.kind)).toEqual(['facts', 'private-key', 'facts']);
    const [first, , third] = views;
    if (first?.kind !== 'facts' || third?.kind !== 'facts') throw new Error('expected facts');
    expect(first.facts.commonName).toBe('leaf.example.com');
    expect(third.facts.commonName).toBe('Example Root CA');
  });
});

describe('validityState', () => {
  it('reports days remaining while valid', () => {
    expect(validityState(daysFromNow(-1), daysFromNow(30), NOW)).toEqual({
      status: 'valid',
      days: 30,
    });
    expect(describeValidity({ status: 'valid', days: 30 })).toBe('Expires in 30 days');
  });

  it('floors a part-day to "today" rather than "in 0 days"', () => {
    const state = validityState(daysFromNow(-1), new Date(NOW.getTime() + 6 * 60 * 60 * 1000), NOW);

    expect(state).toEqual({ status: 'valid', days: 0 });
    expect(describeValidity(state)).toBe('Expires today');
  });

  it('reports expiry the instant notAfter is reached, not a day later', () => {
    expect(validityState(daysFromNow(-100), NOW, NOW)).toEqual({ status: 'expired', days: 0 });
    expect(describeValidity({ status: 'expired', days: 0 })).toBe('Expired today');
  });

  it('counts days since expiry once past', () => {
    const state = validityState(daysFromNow(-100), daysFromNow(-3), NOW);

    expect(state).toEqual({ status: 'expired', days: 3 });
    expect(describeValidity(state)).toBe('Expired 3 days ago');
  });

  it('reports a certificate whose window has not opened yet', () => {
    const state = validityState(daysFromNow(2), daysFromNow(400), NOW);

    expect(state).toEqual({ status: 'not-yet-valid', days: 2 });
    expect(describeValidity(state)).toBe('Not valid yet — in 2 days');
  });

  it('singularizes one day', () => {
    expect(describeValidity({ status: 'valid', days: 1 })).toBe('Expires in 1 day');
    expect(describeValidity({ status: 'expired', days: 1 })).toBe('Expired 1 day ago');
  });

  it('turns warn inside the renewal window and error once it is over', () => {
    expect(validityTone({ status: 'valid', days: 31 })).toBe('good');
    expect(validityTone({ status: 'valid', days: 30 })).toBe('warn');
    expect(validityTone({ status: 'valid', days: 0 })).toBe('warn');
    expect(validityTone({ status: 'expired', days: 0 })).toBe('error');
    expect(validityTone({ status: 'not-yet-valid', days: 5 })).toBe('error');
  });
});

describe('formatFingerprint', () => {
  it('renders colon-separated uppercase hex', () => {
    expect(formatFingerprint(new Uint8Array([0x00, 0x0f, 0xa9, 0xff]).buffer)).toBe('00:0F:A9:FF');
  });
});

describe('describePemText', () => {
  it('reads the facts off a certificate', async () => {
    const fixture = await selfSigned({
      commonName: 'leaf.example.com',
      notBefore: daysFromNow(-10),
      notAfter: daysFromNow(5),
      dnsNames: ['leaf.example.com', 'www.example.com'],
    });

    const views = await describePemText(fixture.pem, NOW);
    const [view] = views;
    if (view?.kind !== 'facts') throw new Error('expected a parsed certificate');

    expect(view.position).toBe(1);
    expect(view.label).toBe('CERTIFICATE');
    expect(view.facts.commonName).toBe('leaf.example.com');
    expect(view.facts.subject).toContain('O=Preview Fixtures');
    expect(view.facts.issuerCommonName).toBe('leaf.example.com');
    expect(view.facts.validity).toEqual({ status: 'valid', days: 5 });
    expect(view.facts.altNames).toEqual(['DNS:leaf.example.com', 'DNS:www.example.com']);
    expect(rowValue(view.facts.rows, 'Serial')).toBe('0ABC');
    expect(rowValue(view.facts.rows, 'Signature')).toBe('ECDSA with SHA-256');
    expect(rowValue(view.facts.rows, 'Public key')).toContain('P-256');
  });

  it('fingerprints the DER, matching an independent SHA-256 of the same bytes', async () => {
    const fixture = await selfSigned({
      commonName: 'fingerprint.example.com',
      notBefore: daysFromNow(-1),
      notAfter: daysFromNow(200),
    });
    const expected = formatFingerprint(
      await crypto.subtle.digest('SHA-256', fixture.certificate.rawData),
    );

    const [view] = await describePemText(fixture.pem, NOW);
    if (view?.kind !== 'facts') throw new Error('expected a parsed certificate');

    expect(rowValue(view.facts.rows, 'SHA-256')).toBe(expected);
  });

  it('marks an expired certificate as expired', async () => {
    const fixture = await selfSigned({
      commonName: 'stale.example.com',
      notBefore: daysFromNow(-400),
      notAfter: daysFromNow(-35),
    });

    const [view] = await describePemText(fixture.pem, NOW);
    if (view?.kind !== 'facts') throw new Error('expected a parsed certificate');

    expect(view.facts.validity).toEqual({ status: 'expired', days: 35 });
  });

  it('numbers a chain in file order', async () => {
    const leaf = await selfSigned({
      commonName: 'leaf.example.com',
      notBefore: daysFromNow(-1),
      notAfter: daysFromNow(60),
    });
    const intermediate = await selfSigned({
      commonName: 'Example Intermediate CA',
      notBefore: daysFromNow(-800),
      notAfter: daysFromNow(800),
    });

    const views = await describePemText(`${leaf.pem}\n${intermediate.pem}\n`, NOW);

    expect(views.map((view) => view.position)).toEqual([1, 2]);
    expect(
      views.map((view) => (view.kind === 'facts' ? view.facts.commonName : view.kind)),
    ).toEqual(['leaf.example.com', 'Example Intermediate CA']);
  });

  it('degrades a block that is not what its armour claims, without echoing its bytes', async () => {
    const views = await describePemText(armour('CERTIFICATE', 'bm90LWEtY2VydGlmaWNhdGU='), NOW);
    const [view] = views;
    if (view?.kind !== 'unreadable') throw new Error('expected an unreadable block');

    expect(view.label).toBe('CERTIFICATE');
    expect(view.message.length).toBeGreaterThan(0);
    expect(JSON.stringify(views)).not.toContain('bm90LWEtY2VydGlmaWNhdGU');
  });
});
