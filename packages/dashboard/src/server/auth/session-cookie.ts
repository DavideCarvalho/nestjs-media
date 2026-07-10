import { createHmac, timingSafeEqual } from 'node:crypto';

/** Clock-skew grace applied to `exp` so a marginally-late clock doesn't bounce a valid cookie. */
const EXP_GRACE_MS = 30_000;

/** The validated console session attached to a request once its cookie verifies. */
export interface ConsoleSession {
  /** Stable user id (the session user's `id`). */
  sub: string;
  /** Optional display name. */
  name?: string;
  /** Free-form role strings; the console does not interpret them. */
  roles: string[];
  /** Issued-at, epoch milliseconds. */
  iat: number;
  /** Expiry, epoch milliseconds. */
  exp: number;
}

/** The session user a host `login`/`session` hook returns to mint a cookie. */
export interface ConsoleSessionUser {
  id: string;
  name?: string;
  roles?: string[];
}

export interface SignOptions {
  secret: string;
  ttlMs: number;
  /** Injectable clock (epoch ms) for deterministic tests. Defaults to `Date.now()`. */
  now?: number;
}

export interface VerifyOptions {
  secret: string;
  now?: number;
}

function base64urlEncode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function base64urlDecode(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function hmac(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

/**
 * Sign a session into the cookie value `base64url(payload).base64url(hmac)`. Stateless
 * HMAC-SHA256, no store — `node:crypto` only, no JWT dependency. Mirrors the telescope
 * dashboard's session cookie so the console gate behaves identically.
 */
export function signSessionCookie(user: ConsoleSessionUser, options: SignOptions): string {
  const issuedAt = options.now ?? Date.now();
  const session: ConsoleSession = {
    sub: user.id,
    ...(user.name !== undefined ? { name: user.name } : {}),
    roles: user.roles ?? [],
    iat: issuedAt,
    exp: issuedAt + options.ttlMs,
  };
  const encodedPayload = base64urlEncode(JSON.stringify(session));
  return `${encodedPayload}.${hmac(options.secret, encodedPayload)}`;
}

/** Type guard for the decoded payload shape — defends against tampered/legacy payloads. */
function isSessionPayload(value: unknown): value is ConsoleSession {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.sub !== 'string') return false;
  if (record.name !== undefined && typeof record.name !== 'string') return false;
  if (!Array.isArray(record.roles)) return false;
  if (!record.roles.every((role) => typeof role === 'string')) return false;
  if (typeof record.iat !== 'number' || !Number.isFinite(record.iat)) return false;
  if (typeof record.exp !== 'number' || !Number.isFinite(record.exp)) return false;
  return true;
}

/**
 * Verify a cookie value and return the session, or `null` for anything tampered, malformed, or
 * expired (past `exp` + a 30s grace). Constant-time signature comparison. NEVER throws — any
 * parse failure yields `null`.
 */
export function verifySessionCookie(value: string, options: VerifyOptions): ConsoleSession | null {
  try {
    const dot = value.indexOf('.');
    if (dot <= 0 || dot === value.length - 1) return null;
    const encodedPayload = value.slice(0, dot);
    const provided = Buffer.from(value.slice(dot + 1), 'base64url');
    const expected = Buffer.from(hmac(options.secret, encodedPayload), 'base64url');
    // timingSafeEqual throws on a length mismatch — guard it so a wrong-length (tampered)
    // signature returns null instead of throwing.
    if (provided.length !== expected.length) return null;
    if (!timingSafeEqual(provided, expected)) return null;
    const decoded: unknown = JSON.parse(base64urlDecode(encodedPayload));
    if (!isSessionPayload(decoded)) return null;
    const now = options.now ?? Date.now();
    if (now > decoded.exp + EXP_GRACE_MS) return null;
    return decoded;
  } catch {
    return null;
  }
}
