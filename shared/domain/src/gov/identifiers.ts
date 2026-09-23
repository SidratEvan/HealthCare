/**
 * The last check before anything leaves the national layer (`FR-GOV-06`).
 *
 * "No patient identifiers are exposed in this layer under any configuration."
 * The first line of that is the database: the government layer reads as
 * `gov_reader`, which can open the aggregate views and nothing else (0026).
 * This is the second, and it looks at what is about to be sent rather than at
 * where it came from.
 *
 * No I/O.
 *
 * ## What it refuses
 *
 * Any key that names a person or a record — an id, a name, a phone, an email,
 * a token — and any value shaped like a UUID or a Bangladeshi mobile number,
 * wherever it sits in the payload. Not one of those belongs in a district
 * count, so finding one means a view or a mapping changed without anybody
 * meaning it to, and the right response is to send nothing.
 *
 * It is a denylist, and a denylist is never the whole defence — which is why
 * it is the second line and not the first.
 */

/**
 * Keys that identify a person, a record or a facility.
 *
 * Case-sensitive on purpose: `Id$` is a camelCase suffix (`patientId`), and
 * matched case-blind it would also catch every key that merely ends in the
 * letters, like `paid`.
 */
const IDENTIFYING_KEY = /(?:^id$|Id$|_id$|^nid$|[Pp]hone|[Ee]mail|[Nn]ame|[Tt]oken)/;

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** `+8801…` or `01…`, eleven digits after the country code is stripped. */
const BD_MOBILE = /(?:\+?88)?01[3-9]\d{8}/;

/**
 * Every path in `value` that carries an identifier, as `a.b[2].c`.
 *
 * Empty means clean. Walks objects and arrays; strings are tested for the
 * value patterns, keys for the key pattern.
 */
export function findIdentifiers(value: unknown, path = ''): string[] {
  if (typeof value === 'string') {
    return UUID.test(value) || BD_MOBILE.test(value) ? [path === '' ? '(root)' : path] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item: unknown, index) => findIdentifiers(item, `${path}[${String(index)}]`));
  }

  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => {
      const at = path === '' ? key : `${path}.${key}`;
      return IDENTIFYING_KEY.test(key) ? [at] : findIdentifiers(child, at);
    });
  }

  return [];
}
