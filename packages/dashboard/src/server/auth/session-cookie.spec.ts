import { describe, expect, it } from 'vitest';
import { signSessionCookie, verifySessionCookie } from './session-cookie.js';

const secret = 'test-secret-key';
const ttlMs = 60_000;

describe('session cookie', () => {
  it('round-trips a signed session', () => {
    const value = signSessionCookie({ id: 'u1', name: 'Ann', roles: ['admin'] }, { secret, ttlMs });
    const session = verifySessionCookie(value, { secret });
    expect(session).toMatchObject({ sub: 'u1', name: 'Ann', roles: ['admin'] });
  });

  it('rejects a tampered signature', () => {
    const value = signSessionCookie({ id: 'u1', roles: [] }, { secret, ttlMs });
    const [payload] = value.split('.');
    expect(verifySessionCookie(`${payload}.deadbeef`, { secret })).toBeNull();
  });

  it('rejects a payload signed with a different secret', () => {
    const value = signSessionCookie({ id: 'u1', roles: [] }, { secret: 'other', ttlMs });
    expect(verifySessionCookie(value, { secret })).toBeNull();
  });

  it('rejects an expired cookie (past the grace)', () => {
    const value = signSessionCookie({ id: 'u1', roles: [] }, { secret, ttlMs, now: 0 });
    expect(verifySessionCookie(value, { secret, now: ttlMs + 60_000 })).toBeNull();
  });

  it('accepts a cookie within its TTL', () => {
    const value = signSessionCookie({ id: 'u1', roles: [] }, { secret, ttlMs, now: 0 });
    expect(verifySessionCookie(value, { secret, now: ttlMs - 1 })).not.toBeNull();
  });

  it('never throws on garbage input', () => {
    expect(verifySessionCookie('not-a-cookie', { secret })).toBeNull();
    expect(verifySessionCookie('', { secret })).toBeNull();
    expect(verifySessionCookie('a.b.c', { secret })).toBeNull();
  });
});
