/**
 * Class-name composition.
 *
 * Deliberately not `clsx` or `classnames`: this is the whole of what those
 * libraries do that this design system needs, and a dependency whose source is
 * shorter than its own README is a dependency worth not having.
 *
 * Falsy entries are dropped so a conditional reads as
 * `cx('base', isActive && 'active')` rather than needing a ternary with an
 * empty string on the other branch.
 */
export type ClassValue = string | false | null | undefined;

export function cx(...values: readonly ClassValue[]): string {
  return values
    .filter((value): value is string => typeof value === 'string' && value !== '')
    .join(' ');
}
