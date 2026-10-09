/**
 * Whose address a host is (`PRD.md` `FR-BRD-07`, `FR-BRD-04`; plan C2).
 *
 * The patient app opened at `<code>.<platform domain>`, or at a domain a
 * hospital owns and a platform administrator has recorded for it, is that
 * hospital's portal with no parameter. The platform's own address is the
 * network.
 *
 * This file is the part of that which needs no database: reading a host name
 * and saying which of three things it is. The API and the patient app both
 * use it, so the two can never disagree about an address.
 *
 * ## Without a platform domain
 *
 * Every host is the network's. A deployment that has not been given a domain
 * of its own (the demonstration, a developer's machine) has no way to tell
 * its own address from a stranger's, and guessing would make somebody's
 * preview link into nobody's portal. `?scope=` goes on working there, as it
 * always has (`FR-BRD-02`).
 */

import { z } from 'zod';

/**
 * Labels under the platform's domain that are the platform's own, and can
 * never be a hospital's code in an address.
 */
export const RESERVED_PORTAL_LABELS = [
  'www',
  'app',
  'api',
  'console',
  'admin',
  'staff',
  'status',
  'mail',
] as const;

/** A hospital's code as an address label: `hospitals.code`, lower-case. */
const CODE_LABEL = /^[a-z0-9][a-z0-9-]{1,15}$/;

/** A DNS name: labels of letters, digits and hyphens, at least two of them. */
const HOST_NAME =
  /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

export type PortalHost =
  /** The platform's own address: the whole network. */
  | { readonly kind: 'network' }
  /** `<code>.<platform domain>`: that hospital's portal, if there is such a hospital. */
  | { readonly kind: 'code'; readonly code: string }
  /**
   * Some other name. A hospital's own domain if one is recorded for it, which
   * only the server can say; otherwise nobody's.
   */
  | { readonly kind: 'foreign'; readonly host: string };

/**
 * A host as it is compared: lower-case, without a port, a trailing dot or
 * anything that is not a host. Null when it is not a host name at all.
 */
export function normaliseHost(value: string): string | null {
  let host = value.trim().toLowerCase();
  // `host:port`, but not an IPv6 literal, which this product is never served at.
  if (host.includes('[') || host.includes(']')) return null;
  const colon = host.lastIndexOf(':');
  if (colon >= 0) {
    if (!/^\d{1,5}$/.test(host.slice(colon + 1))) return null;
    host = host.slice(0, colon);
  }
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (host === 'localhost') return host;
  if (IPV4.test(host)) return host;
  if (/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.localhost$/.test(host)) return host;
  return HOST_NAME.test(host) ? host : null;
}

/**
 * Which of the three a host is.
 *
 * `platformDomain` is the deployment's own (`PLATFORM_DOMAIN`), or null when
 * it has none. `localhost` is allowed as one, so that a developer's machine
 * and the browser tests can open `padma.localhost` as a portal.
 */
export function portalHostOf(hostname: string, platformDomain: string | null): PortalHost {
  const host = normaliseHost(hostname);
  const domain = platformDomain === null ? null : normaliseHost(platformDomain);
  if (host === null || domain === null) return { kind: 'network' };

  if (host === domain) return { kind: 'network' };

  if (host.endsWith(`.${domain}`)) {
    const label = host.slice(0, -(domain.length + 1));
    if (
      !label.includes('.') &&
      CODE_LABEL.test(label) &&
      !(RESERVED_PORTAL_LABELS as readonly string[]).includes(label)
    ) {
      return { kind: 'code', code: label.toUpperCase() };
    }
    // The platform's own labels, and anything deeper than one: the network.
    return { kind: 'network' };
  }

  // A machine's own address is never a hospital's domain.
  if (host === 'localhost' || IPV4.test(host) || host.endsWith('.localhost')) {
    return { kind: 'network' };
  }
  return { kind: 'foreign', host };
}

/** The address of a hospital's portal under the platform's domain. */
export function portalHostFor(code: string, platformDomain: string): string {
  return `${code.toLowerCase()}.${platformDomain.toLowerCase()}`;
}

/**
 * A domain a hospital owns, as a platform administrator records it
 * (`POST /platform/hospitals/:id/domain`).
 *
 * A host name and nothing else: no scheme, no path, no port. Lower-cased, so
 * that the one stored is the one compared.
 */
export const portalDomain = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .refine(
    (value) => HOST_NAME.test(value) && !IPV4.test(value) && !value.endsWith('.localhost'),
    'must be a domain name, e.g. portal.example-hospital.com.bd',
  );

/** `POST /platform/hospitals/:id/domain`: the domain, or null to remove it. */
export const portalDomainBody = z.strictObject({ domain: portalDomain.nullable() });
export type PortalDomainBody = z.infer<typeof portalDomainBody>;
