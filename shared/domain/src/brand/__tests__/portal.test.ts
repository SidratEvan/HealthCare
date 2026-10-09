/**
 * Whose address a host is (`FR-BRD-07`; plan C2).
 */

import { describe, expect, it } from 'vitest';

import {
  RESERVED_PORTAL_LABELS,
  normaliseHost,
  portalDomain,
  portalDomainBody,
  portalHostFor,
  portalHostOf,
} from '../portal.js';

const DOMAIN = 'medlivebd.example';

describe('a host is the network’s, a hospital’s by its code, or somebody else’s', () => {
  it('the platform’s own address is the network', () => {
    expect(portalHostOf(DOMAIN, DOMAIN)).toEqual({ kind: 'network' });
    expect(portalHostOf(`${DOMAIN}:443`, DOMAIN)).toEqual({ kind: 'network' });
    expect(portalHostOf(`${DOMAIN.toUpperCase()}.`, DOMAIN)).toEqual({ kind: 'network' });
  });

  it('a hospital’s code in front of it is that hospital’s portal', () => {
    expect(portalHostOf(`padma.${DOMAIN}`, DOMAIN)).toEqual({ kind: 'code', code: 'PADMA' });
    expect(portalHostOf(`Padma.${DOMAIN}:3000`, DOMAIN)).toEqual({ kind: 'code', code: 'PADMA' });
    expect(portalHostOf(`city-care-2.${DOMAIN}`, DOMAIN)).toEqual({
      kind: 'code',
      code: 'CITY-CARE-2',
    });
  });

  it.each(RESERVED_PORTAL_LABELS)('%s is the platform’s own label, never a hospital', (label) => {
    expect(portalHostOf(`${label}.${DOMAIN}`, DOMAIN)).toEqual({ kind: 'network' });
  });

  it('a name deeper than one label is not a code', () => {
    expect(portalHostOf(`a.padma.${DOMAIN}`, DOMAIN)).toEqual({ kind: 'network' });
  });

  it('a name that only ends like the domain is somebody else’s', () => {
    expect(portalHostOf(`evil${DOMAIN}`, DOMAIN)).toEqual({
      kind: 'foreign',
      host: `evil${DOMAIN}`,
    });
    expect(portalHostOf(`${DOMAIN}.attacker.example`, DOMAIN)).toEqual({
      kind: 'foreign',
      host: `${DOMAIN}.attacker.example`,
    });
  });

  it('any other name is somebody else’s, for the server to look up', () => {
    expect(portalHostOf('portal.city-hospital.example', DOMAIN)).toEqual({
      kind: 'foreign',
      host: 'portal.city-hospital.example',
    });
  });

  it('a machine’s own address is the network, whatever the platform’s domain is', () => {
    for (const host of ['localhost', 'localhost:3000', '127.0.0.1', '192.168.1.20:3000']) {
      expect(portalHostOf(host, DOMAIN), host).toEqual({ kind: 'network' });
    }
  });

  it('with localhost as the platform’s domain, a developer opens a portal by name', () => {
    expect(portalHostOf('localhost:3000', 'localhost')).toEqual({ kind: 'network' });
    expect(portalHostOf('padma.localhost:3000', 'localhost')).toEqual({
      kind: 'code',
      code: 'PADMA',
    });
    expect(portalHostOf('api.localhost:4000', 'localhost')).toEqual({ kind: 'network' });
  });

  it('with no platform domain, every host is the network', () => {
    for (const host of [`padma.${DOMAIN}`, 'portal.city-hospital.example', 'localhost']) {
      expect(portalHostOf(host, null), host).toEqual({ kind: 'network' });
    }
  });

  it('what is not a host is the network, not an error', () => {
    for (const host of ['', '  ', 'a b', 'http://x', '[::1]:3000', 'x:notaport', '-bad-.example']) {
      expect(portalHostOf(host, DOMAIN), host).toEqual({ kind: 'network' });
    }
  });
});

describe('a host as it is compared', () => {
  it('is lower-case, without its port or a trailing dot', () => {
    expect(normaliseHost(' Portal.Example.COM:8443 ')).toBe('portal.example.com');
    expect(normaliseHost('example.com.')).toBe('example.com');
    expect(normaliseHost('padma.localhost:3000')).toBe('padma.localhost');
  });

  it('is null when it is not a host', () => {
    expect(normaliseHost('exa mple.com')).toBeNull();
    expect(normaliseHost('example.com/path')).toBeNull();
    expect(normaliseHost('single')).toBeNull();
  });
});

describe('a domain a hospital owns, as it is recorded', () => {
  it('is a name and nothing else', () => {
    expect(portalDomain.parse(' Portal.City-Hospital.COM.BD ')).toBe('portal.city-hospital.com.bd');
    for (const bad of [
      'https://portal.example.com',
      'portal.example.com/book',
      'portal.example.com:8080',
      'localhost',
      'padma.localhost',
      '10.0.0.1',
      'nodot',
      '',
    ]) {
      expect(portalDomain.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('or null, to remove it', () => {
    expect(portalDomainBody.parse({ domain: null })).toEqual({ domain: null });
    expect(portalDomainBody.safeParse({}).success).toBe(false);
    expect(portalDomainBody.safeParse({ domain: 'a.example', other: 1 }).success).toBe(false);
  });
});

describe('a hospital’s address under the platform’s domain', () => {
  it('is its code, lower-case, in front', () => {
    expect(portalHostFor('PADMA', DOMAIN)).toBe(`padma.${DOMAIN}`);
    // And reads back as that hospital.
    expect(portalHostOf(portalHostFor('PADMA', DOMAIN), DOMAIN)).toEqual({
      kind: 'code',
      code: 'PADMA',
    });
  });
});
