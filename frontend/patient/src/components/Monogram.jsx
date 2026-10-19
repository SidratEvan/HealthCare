function firstGrapheme(name) {
  const trimmed = name.trim();
  if (trimmed === '') return '';
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const first = segmenter.segment(trimmed)[Symbol.iterator]().next().value;
  return (first?.segment ?? trimmed.charAt(0)).toLocaleUpperCase();
}

const SIZE = {
  sm: 'size-10 text-title-sm',
  md: 'size-12 text-title-md',
  lg: 'size-[60px] text-title-lg',
};

export function Monogram({ name, size = 'md' }) {
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-pill bg-brand-100 font-bold text-brand-700 ${SIZE[size]}`}
    >
      {firstGrapheme(name)}
    </span>
  );
}
