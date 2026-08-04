// `@peculiar/x509` reaches tsyringe for its extension/algorithm registries, and tsyringe throws on
// import unless `Reflect.getMetadata` exists. It has to be imported here rather than in `main.tsx`
// because this renderer is lazily loaded (see `./registry.tsx`) — putting the polyfill in the app
// entry would charge every visitor for it, and this import keeps it inside the certificate chunk,
// where the dependency that needs it already lives. Order matters: it must evaluate before x509 does.
import 'reflect-metadata';
import * as x509 from '@peculiar/x509';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { mediaConsoleClient } from '../../client/media-console-client.js';
import { Alert, Button, Notice, formatBytes } from '../ui.js';
import { FallbackCard, SAMPLE_TEXT_BYTES, readErrorMessage } from './shared.js';
import type { PreviewItem } from './types.js';

/**
 * THE ONE RULE IN THIS FILE: a private key block's bytes never reach the screen.
 *
 * A `.pem` in a bucket is very often a bundle — leaf, intermediates, and the key that goes with them,
 * concatenated. Rendering that last block would paint the key onto an admin's monitor, into whatever
 * screen recording or screenshot the session produces, and into the DOM where anything running on the
 * page can read it. There is also nothing to *learn* from looking at it: the question people open a
 * certificate file to answer is "when does this expire", and a key answers nothing.
 *
 * So the refusal is structural rather than a `if (!showKeys)` guard someone can flip: the view model
 * for a key block (`{ kind: 'private-key' }`) has no field capable of carrying bytes, and
 * `describePemBlock` returns it *before* the base64 is passed to any parser, digest or formatter.
 * Nothing downstream — not a truncated preview, not a fingerprint, not a key size — can be added
 * later without first widening that type, which is exactly the speed bump this wants to be.
 */

/** A single armoured section of a PEM file: the label between the dashes, and the base64 payload with
 *  its line breaks squeezed out. */
export interface PemBlock {
  label: string;
  body: string;
}

/**
 * Matches one `-----BEGIN X-----…-----END X-----` section.
 *
 * Three details carry weight. The backreference means a mismatched pair — a truncated download, a
 * hand-edited bundle — simply fails to match instead of swallowing the rest of the file into one
 * enormous "block". `[\s\S]` rather than `.` is what lets a body span lines at all, and it eats `\r`
 * along the way, so a file saved on Windows splits identically to one saved on Linux. And anything
 * *outside* a matched pair is skipped by construction: openssl likes to print a human-readable dump
 * above each certificate, bundles carry comment headers naming each CA, and editors leave trailing
 * newlines — none of it is armour, so none of it becomes a block.
 */
const PEM_BLOCK = /-----BEGIN ([A-Z0-9][A-Z0-9 ]*)-----([\s\S]*?)-----END \1-----/g;

/** Splits a PEM file into its armoured blocks, in file order — which is the order that matters, since
 *  a chain is conventionally written leaf first and reading it in order is how you check it. */
export function splitPemBlocks(text: string): PemBlock[] {
  const blocks: PemBlock[] = [];
  for (const match of text.matchAll(PEM_BLOCK)) {
    const label = match[1];
    const body = match[2];
    if (label === undefined || body === undefined) continue;
    blocks.push({ label: label.trim(), body: body.replace(/\s+/g, '') });
  }
  return blocks;
}

/**
 * Whether a block's armour declares private key material.
 *
 * Matched on a substring rather than an enumerated list of labels on purpose. The variants in the
 * wild all share the same tail — `PRIVATE KEY`, `RSA PRIVATE KEY`, `EC PRIVATE KEY`,
 * `DSA PRIVATE KEY`, `ENCRYPTED PRIVATE KEY`, `OPENSSH PRIVATE KEY` — and the failure mode of a list
 * is that the one label it forgot gets rendered. Here the failure mode of an unfamiliar label is that
 * it is treated as a key and withheld, which is the direction to fail in.
 */
export function isPrivateKeyBlock(label: string): boolean {
  return label.toUpperCase().includes('PRIVATE KEY');
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Where a certificate sits relative to now, and by how many whole days. `days` counts down to
 *  `notAfter` while valid, up from it once expired, and down to `notBefore` before it starts. */
export interface ValidityState {
  status: 'valid' | 'expired' | 'not-yet-valid';
  days: number;
}

/** `now` is a parameter rather than a `Date.now()` call inside so this is testable without freezing
 *  the clock, and so every card in a chain is judged against the same instant. */
export function validityState(notBefore: Date, notAfter: Date, now: Date): ValidityState {
  const nowMs = now.getTime();
  if (nowMs < notBefore.getTime()) {
    return { status: 'not-yet-valid', days: Math.floor((notBefore.getTime() - nowMs) / DAY_MS) };
  }
  // `>=` not `>`: a certificate is dead *at* notAfter, and the boundary second is exactly when
  // someone is most likely to be staring at this pane trying to work out why TLS broke.
  if (nowMs >= notAfter.getTime()) {
    return { status: 'expired', days: Math.floor((nowMs - notAfter.getTime()) / DAY_MS) };
  }
  return { status: 'valid', days: Math.floor((notAfter.getTime() - nowMs) / DAY_MS) };
}

/** The one-line answer to the question the file was opened to answer. Whole days floor to zero on the
 *  last/first day, so those get "today" wording rather than a misleading "in 0 days". */
export function describeValidity(state: ValidityState): string {
  const plural = state.days === 1 ? '' : 's';
  switch (state.status) {
    case 'not-yet-valid':
      return state.days === 0
        ? 'Not valid yet — starts today'
        : `Not valid yet — in ${state.days} day${plural}`;
    case 'expired':
      return state.days === 0 ? 'Expired today' : `Expired ${state.days} day${plural} ago`;
    case 'valid':
      return state.days === 0 ? 'Expires today' : `Expires in ${state.days} day${plural}`;
  }
}

/** Renewal windows are typically 30 days, so that is where "fine" turns into "someone should look". */
const EXPIRY_WARNING_DAYS = 30;

export function validityTone(state: ValidityState): 'good' | 'warn' | 'error' {
  if (state.status !== 'valid') return 'error';
  return state.days <= EXPIRY_WARNING_DAYS ? 'warn' : 'good';
}

/** Colon-separated uppercase hex — the form openssl prints and the form people paste into a browser's
 *  certificate viewer to compare, so it can be eyeballed against one without reformatting. */
export function formatFingerprint(digest: ArrayBuffer): string {
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0').toUpperCase(),
  ).join(':');
}

export interface FactRow {
  label: string;
  value: string;
}

/** Everything worth showing about one parsed certificate or request, already flattened to strings —
 *  the render stays synchronous and dumb because the digesting (async, WebCrypto) happened in the
 *  query function. */
export interface CertificateFacts {
  commonName: string;
  subject: string;
  /** `null` for a certificate request, which has no issuer until someone signs it. */
  issuerCommonName: string | null;
  issuer: string | null;
  /** `null` for a certificate request, which carries no validity window. */
  validity: ValidityState | null;
  rows: FactRow[];
  altNames: string[];
}

export type CertificateBlockView =
  | { kind: 'private-key'; position: number; label: string }
  | { kind: 'facts'; position: number; label: string; facts: CertificateFacts }
  | { kind: 'unreadable'; position: number; label: string; message: string };

/** The CN is what people mean by "which certificate is this"; the full DN is kept beside it because
 *  internal CAs regularly issue several certificates whose CNs are identical and whose OUs are not. */
function commonNameOf(name: x509.Name, fallback: string): string {
  return name.getField('CN')[0] ?? fallback;
}

/** SANs, not the CN, are what browsers actually match on — a certificate whose CN looks right and
 *  whose SAN list does not contain the host is the single most common "but it's the right cert" bug. */
function subjectAltNames(extensions: readonly x509.Extension[]): string[] {
  for (const extension of extensions) {
    if (extension instanceof x509.SubjectAlternativeNameExtension) {
      return extension.names.items.map((name) => `${name.type.toUpperCase()}:${name.value}`);
    }
  }
  return [];
}

function describeSignatureAlgorithm(algorithm: x509.HashedAlgorithm): string {
  // Ed25519/Ed448 sign without a separate hash step; `hash` is typed as always present but genuinely
  // is not there for those, so read it defensively rather than printing "… with undefined".
  const hashName = algorithm.hash?.name;
  return hashName ? `${algorithm.name} with ${hashName}` : algorithm.name;
}

/** WebCrypto's `Algorithm` only promises a name, but the interesting part of a key is its size or its
 *  curve — read those off the same object by narrowing, since the runtime shape is richer than the
 *  declared type and casting around that is how the wrong field gets printed. */
function describeKeyAlgorithm(algorithm: Algorithm): string {
  const parts: string[] = [algorithm.name];
  if ('modulusLength' in algorithm && typeof algorithm.modulusLength === 'number') {
    parts.push(`${algorithm.modulusLength} bit`);
  }
  if ('namedCurve' in algorithm && typeof algorithm.namedCurve === 'string') {
    parts.push(algorithm.namedCurve);
  }
  return parts.join(' · ');
}

async function sha256Fingerprint(der: ArrayBuffer): Promise<string> {
  // `crypto.subtle` only exists in a secure context, so a console served over plain HTTP on a
  // non-localhost host has none. Say so on the one row it affects rather than failing the whole card:
  // every other fact on it parsed fine and the expiry date is still the thing they came for.
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    return 'unavailable — needs a secure context (HTTPS)';
  }
  return formatFingerprint(await crypto.subtle.digest('SHA-256', der));
}

function formatDateTime(date: Date): string {
  return date.toLocaleString();
}

async function describeCertificate(
  source: string | BufferSource,
  now: Date,
): Promise<CertificateFacts> {
  const certificate = new x509.X509Certificate(source);
  const validity = validityState(certificate.notBefore, certificate.notAfter, now);
  return {
    commonName: commonNameOf(certificate.subjectName, certificate.subject),
    subject: certificate.subject,
    issuerCommonName: commonNameOf(certificate.issuerName, certificate.issuer),
    issuer: certificate.issuer,
    validity,
    rows: [
      { label: 'Serial', value: certificate.serialNumber.toUpperCase() },
      { label: 'Not before', value: formatDateTime(certificate.notBefore) },
      { label: 'Not after', value: formatDateTime(certificate.notAfter) },
      { label: 'Signature', value: describeSignatureAlgorithm(certificate.signatureAlgorithm) },
      { label: 'Public key', value: describeKeyAlgorithm(certificate.publicKey.algorithm) },
      { label: 'SHA-256', value: await sha256Fingerprint(certificate.rawData) },
    ],
    altNames: subjectAltNames(certificate.extensions),
  };
}

async function describeRequest(source: string | BufferSource): Promise<CertificateFacts> {
  const request = new x509.Pkcs10CertificateRequest(source);
  return {
    commonName: commonNameOf(request.subjectName, request.subject),
    subject: request.subject,
    issuerCommonName: null,
    issuer: null,
    validity: null,
    rows: [
      { label: 'Signature', value: describeSignatureAlgorithm(request.signatureAlgorithm) },
      { label: 'Public key', value: describeKeyAlgorithm(request.publicKey.algorithm) },
      { label: 'SHA-256', value: await sha256Fingerprint(request.rawData) },
    ],
    altNames: subjectAltNames(request.extensions),
  };
}

/**
 * Turns one armoured block into something renderable.
 *
 * The private key branch is first and returns immediately, so `block.body` is never handed to a
 * parser, a digest, or a string formatter for a key. See the file header for why that ordering is the
 * feature and not an accident.
 */
export async function describePemBlock(
  block: PemBlock,
  position: number,
  now: Date,
): Promise<CertificateBlockView> {
  if (isPrivateKeyBlock(block.label)) {
    return { kind: 'private-key', position, label: block.label };
  }
  try {
    const facts = block.label.includes('CERTIFICATE REQUEST')
      ? await describeRequest(block.body)
      : await describeCertificate(block.body, now);
    return { kind: 'facts', position, label: block.label, facts };
  } catch (error) {
    // A block that is not what its armour claims degrades to a sentence about it. Notably NOT to its
    // base64: "we couldn't read it" is never a reason to dump bytes we have just failed to identify.
    return {
      kind: 'unreadable',
      position,
      label: block.label,
      message: readErrorMessage(error, 'This block could not be parsed.'),
    };
  }
}

/** Parses a whole PEM file. Blocks are described concurrently but collected in file order, because a
 *  chain read out of order is not a chain. */
export async function describePemText(text: string, now: Date): Promise<CertificateBlockView[]> {
  const blocks = splitPemBlocks(text);
  return Promise.all(blocks.map((block, index) => describePemBlock(block, index + 1, now)));
}

/** Parses a bare DER payload — one certificate, or one request, with no armour to say which. Order of
 *  attempts is frequency: `.der`/`.cer` in a bucket is a certificate far more often than a CSR. */
export async function describeDer(bytes: ArrayBuffer, now: Date): Promise<CertificateBlockView[]> {
  try {
    const facts = await describeCertificate(bytes, now);
    return [{ kind: 'facts', position: 1, label: 'CERTIFICATE', facts }];
  } catch {
    // Not a certificate — fall through and try it as a request before giving up.
  }
  try {
    const facts = await describeRequest(bytes);
    return [{ kind: 'facts', position: 1, label: 'CERTIFICATE REQUEST', facts }];
  } catch (error) {
    return [
      {
        kind: 'unreadable',
        position: 1,
        label: 'DER',
        message: readErrorMessage(error, 'This file is not a DER certificate or request.'),
      },
    ];
  }
}

interface CertificateSource {
  blocks: CertificateBlockView[];
  truncated: boolean;
  bytesRead: number;
}

/**
 * Reads the object once as text and decides from the bytes, not the file name, which shape it is.
 *
 * The extension is no help here: `.pem`, `.crt` and `.cer` are each used for both the armoured and the
 * raw form depending on who exported it, and `.der` occasionally holds PEM. Since these files are
 * small — a chain is a few KB — a text read costs nothing and the presence of the BEGIN armour is a
 * definitive answer. Only when it is absent is the object pulled again as bytes, because a DER payload
 * decoded as UTF-8 is already lossy and cannot be parsed back out of the string.
 */
async function readCertificateObject(item: PreviewItem, now: Date): Promise<CertificateSource> {
  const head = await mediaConsoleClient.objectTextHead(item.disk, item.key, SAMPLE_TEXT_BYTES);
  if (head.text.includes('-----BEGIN ')) {
    return {
      blocks: await describePemText(head.text, now),
      truncated: head.bytesRead < item.size,
      bytesRead: head.bytesRead,
    };
  }
  const bytes = await mediaConsoleClient.objectBytes(item.disk, item.key);
  return { blocks: await describeDer(bytes, now), truncated: false, bytesRead: item.size };
}

/** The expiry verdict, loud when it needs to be: a chip while there is time, an `Alert` once it is
 *  expired, not yet valid, or inside the renewal window. */
function ValidityBadge({ state }: { state: ValidityState }): JSX.Element {
  const tone = validityTone(state);
  if (tone === 'good') {
    return (
      <span className="mono shrink-0 rounded-md border border-good/30 bg-good/10 px-2 py-0.5 text-[11px] text-good">
        {describeValidity(state)}
      </span>
    );
  }
  return (
    <Alert variant={tone} className="shrink-0">
      {describeValidity(state)}
    </Alert>
  );
}

/** One certificate, laid out like the console's other fact strips (see `ObjectInsights` in
 *  `../Lightbox.tsx`): a bordered panel, a small uppercase caption, and `label` / `value` rows. Values
 *  are truncated with the whole string on `title`, because a SHA-256 fingerprint is 95 characters and
 *  wrapping every one of them would push the next certificate in the chain off the screen. */
function CertificateCard({
  position,
  label,
  facts,
}: { position: number; label: string; facts: CertificateFacts }): JSX.Element {
  const [showFullNames, setShowFullNames] = useState(false);

  return (
    <div className="shrink-0 rounded-md border border-border bg-panel px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-zinc-500">
            {position}. {label}
          </div>
          <div className="mono mt-0.5 truncate text-sm text-zinc-100" title={facts.subject}>
            {facts.commonName}
          </div>
          {facts.issuerCommonName !== null && (
            <div className="mono truncate text-[11px] text-zinc-500" title={facts.issuer ?? ''}>
              issued by {facts.issuerCommonName}
            </div>
          )}
        </div>
        {facts.validity && <ValidityBadge state={facts.validity} />}
      </div>

      <div className="mt-2">
        {facts.rows.map((row) => (
          <div key={row.label} className="mt-1 flex items-baseline gap-2 text-xs">
            <span className="w-24 shrink-0 text-zinc-500">{row.label}</span>
            <span className="mono tnum truncate text-zinc-200" title={row.value}>
              {row.value}
            </span>
          </div>
        ))}
      </div>

      {facts.altNames.length > 0 && (
        <div className="mt-2">
          <div className="text-[10px] uppercase tracking-wide text-zinc-500">
            Subject alternative names
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {facts.altNames.map((name) => (
              <span
                key={name}
                className="mono rounded border border-border px-1 py-0.5 text-[10px] text-zinc-300"
              >
                {name}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-2">
        <Button tone="quiet" onClick={() => setShowFullNames((shown) => !shown)}>
          {showFullNames ? 'Hide distinguished names' : 'Show distinguished names'}
        </Button>
        {showFullNames && (
          <div className="mt-1">
            <div className="mt-1 flex items-baseline gap-2 text-xs">
              <span className="w-24 shrink-0 text-zinc-500">Subject</span>
              <span className="mono break-all text-zinc-200">{facts.subject}</span>
            </div>
            {facts.issuer !== null && (
              <div className="mt-1 flex items-baseline gap-2 text-xs">
                <span className="w-24 shrink-0 text-zinc-500">Issuer</span>
                <span className="mono break-all text-zinc-200">{facts.issuer}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function BlockCard({ block }: { block: CertificateBlockView }): JSX.Element {
  switch (block.kind) {
    case 'private-key':
      // The whole card for this block. There is deliberately nothing else here — no header, no size,
      // no fingerprint, no truncated sample. See the file header.
      return (
        <Alert variant="error" className="shrink-0">
          Block {block.position} is a {block.label} — private key material is not displayed.
        </Alert>
      );
    case 'unreadable':
      return (
        <Alert variant="warn" className="shrink-0">
          Block {block.position} is labelled {block.label} but could not be read: {block.message}
        </Alert>
      );
    case 'facts':
      return <CertificateCard position={block.position} label={block.label} facts={block.facts} />;
  }
}

/**
 * Renders a `.pem` / `.crt` / `.cer` / `.der` / `.csr` object as the certificates inside it: subject
 * and issuer, serial, validity window with an expiry verdict, SANs, algorithms and a SHA-256
 * fingerprint. A bundle holding a leaf plus its intermediates renders as the chain it is, in file
 * order, because "which link expires first" is usually the actual question.
 *
 * Private key blocks are named and withheld — see the file header, which is the important comment in
 * this file.
 */
export function CertificatePreview({ item }: { item: PreviewItem }): JSX.Element {
  const query = useQuery({
    queryKey: ['certificate-blocks', item.disk, item.key],
    // One clock for the whole file, taken when it is read: the cards in a chain are compared against
    // each other, and two of them measured against instants milliseconds apart is a needless way for
    // "expires in 30 days" and "expires in 29 days" to disagree about the same date.
    queryFn: () => readCertificateObject(item, new Date()),
    retry: false,
    staleTime: 60_000,
  });

  if (query.isLoading) return <Notice>Loading…</Notice>;
  if (query.isError || !query.data) {
    return (
      <FallbackCard
        item={item}
        message={readErrorMessage(query.error, 'Could not read this file.')}
      />
    );
  }

  const { blocks, truncated, bytesRead } = query.data;
  if (blocks.length === 0) {
    return (
      <FallbackCard item={item} message="No certificate or PEM block was found in this file." />
    );
  }
  // Nothing in the file was identifiable — that is a whole-file verdict, so it gets the whole-file
  // surface with the link to the original, rather than a stack of per-block warnings.
  if (blocks.every((block) => block.kind === 'unreadable')) {
    return (
      <FallbackCard
        item={item}
        message="This does not parse as a certificate, a certificate request, or a chain."
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto">
      {truncated && (
        <Alert variant="warn" className="shrink-0">
          Sample — the first {formatBytes(bytesRead)} of {formatBytes(item.size)}. A block
          straddling the cut-off is not shown; open the original ↗ for the whole file.
        </Alert>
      )}
      {blocks.length > 1 && (
        <div className="shrink-0 text-[10px] uppercase tracking-wide text-zinc-500">
          Chain — {blocks.length} blocks, in file order
        </div>
      )}
      {blocks.map((block) => (
        <BlockCard key={`${block.position}-${block.label}`} block={block} />
      ))}
    </div>
  );
}
