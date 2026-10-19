export function cx(...values) {
  return values.filter((value) => typeof value === 'string' && value !== '').join(' ');
}
