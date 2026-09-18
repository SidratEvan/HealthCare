/**
 * The Tailwind preset (FRONTEND.md §9, §10).
 *
 * "Tailwind CSS mapped to the CSS-variable token layer. Tokens in `:root`,
 * Tailwind config references them only; a component never sees a hex."
 *
 * That indirection is the whole point. Every utility below resolves to a
 * `var(--token)`, so there is exactly one place a colour is defined
 * (`shared/ui/src/tokens/tokens.css`) and no way for an app to hard-code one
 * and have it look right. FRONTEND.md §10: "if a colour or radius appears in
 * an app package, it is a bug."
 *
 * The default palette is replaced rather than extended. Leaving Tailwind's own
 * scale in place would leave `bg-indigo-500` one keystroke away — and an
 * indigo primary is the first item on the banned list (§0.2), because it is
 * the default accent of every generated app.
 */

/** `var(--name)`, or `var(--name / <alpha>)` where Tailwind asks for opacity. */
const token = (name) => `var(--${name})`;

export default {
  // No `darkMode: 'media'`. The patient app ships light-only in v1 because
  // most patients use it outdoors in daylight (§1.2); the console gets dark
  // mode in v1.1 as an explicit class, not by guessing at the OS setting.
  darkMode: ['class', '[data-theme="dark"]'],

  theme: {
    // Replaced, not extended — see the note above about indigo.
    colors: {
      transparent: 'transparent',
      current: 'currentColor',

      canvas: token('bg-canvas'),
      surface: token('bg-surface'),
      sunken: token('bg-sunken'),
      inverse: token('bg-inverse'),

      ink: {
        DEFAULT: token('ink-primary'),
        secondary: token('ink-secondary'),
        muted: token('ink-muted'),
        inverse: token('ink-inverse'),
      },

      brand: {
        900: token('brand-900'),
        700: token('brand-700'),
        600: token('brand-600'),
        300: token('brand-300'),
        100: token('brand-100'),
        border: token('brand-border'),
      },

      // Reserved for emergency and genuine danger (§1.1 colour law). A
      // "cancel booking" button is neutral, not red: if red loses its
      // meaning, the emergency button loses its power.
      alert: {
        700: token('alert-700'),
        600: token('alert-600'),
        100: token('alert-100'),
      },

      // Exactly three meanings: doctor delay, stale data, late patient.
      warn: {
        700: token('warn-700'),
        600: token('warn-600'),
        100: token('warn-100'),
        border: token('warn-border'),
      },

      line: {
        strong: token('line-strong'),
        DEFAULT: token('line-soft'),
        hairline: token('line-hairline'),
      },

      // White exists only for text and fills *on* brand or alert surfaces.
      // Pure white is never the page ground (§0.2).
      white: '#FFFFFF',
    },

    // §3.1: 4px base, but the usable set is deliberately small. A value that
    // is not here is a value somebody invented.
    spacing: {
      0: '0px',
      1: token('space-1'),
      2: token('space-2'),
      3: token('space-3'),
      4: token('space-4'),
      5: token('space-5'),
      6: token('space-6'),
      8: token('space-8'),
      10: token('space-10'),
      14: token('space-14'),
      18: token('space-18'),
      gutter: token('gutter-mobile'),
      'gutter-console': token('gutter-console'),
    },

    // §3.2: radius scales with the element's size. A single radius everywhere
    // is a tell, so there is no `rounded` default that suits everything.
    borderRadius: {
      none: '0px',
      xs: token('radius-xs'),
      sm: token('radius-sm'),
      md: token('radius-md'),
      lg: token('radius-lg'),
      pill: token('radius-pill'),
    },

    // §3.3: depth is surface plus a hairline. Shadows are neutral-tinted and
    // never applied to two layers at once.
    boxShadow: {
      none: 'none',
      1: token('elev-1'),
      2: token('elev-2'),
      3: token('elev-3'),
    },

    // Hairlines mean 1px borders do most of the work; 4px exists only so the
    // banned left-accent strip (§0.2) cannot be built by accident at 8.
    borderWidth: { 0: '0px', DEFAULT: '1px', 1.5: '1.5px', 2: '2px' },

    fontFamily: {
      ui: [token('font-ui')],
      reading: [token('font-reading')],
    },

    // §2.3. Line heights are unitless so they scale with the size, and the
    // body floor is 1.65 because cramped Bangla is the most common amateur
    // tell (TYP-01).
    fontSize: {
      'display-xl': ['56px', { lineHeight: '1.15', fontWeight: '700' }],
      'display-lg': ['40px', { lineHeight: '1.2', fontWeight: '700' }],
      'title-lg': ['24px', { lineHeight: '1.35', fontWeight: '700' }],
      'title-md': ['20px', { lineHeight: '1.4', fontWeight: '600' }],
      'title-sm': ['17px', { lineHeight: '1.45', fontWeight: '600' }],
      'body-lg': ['16px', { lineHeight: '1.65' }],
      'body-md': ['15px', { lineHeight: '1.65' }],
      'body-sm': ['13px', { lineHeight: '1.6' }],
      caption: ['12px', { lineHeight: '1.55', fontWeight: '500' }],
    },

    // §3.4. No bounce, no spring overshoot — motion explains a change of
    // state, it does not entertain.
    transitionDuration: {
      instant: token('motion-instant'),
      quick: token('motion-quick'),
      sheet: token('motion-sheet'),
      count: token('motion-count'),
    },
    transitionTimingFunction: {
      standard: token('ease-standard'),
      sheet: token('ease-sheet'),
      count: token('ease-count'),
    },

    extend: {
      // FR-LOC-04: 44px is the floor for anything tappable.
      minHeight: { touch: '44px' },
      minWidth: { touch: '44px' },
    },
  },

  corePlugins: {
    // Bangla has no case, so uppercasing is meaningless and letter-spacing is
    // actively damaging (TYP-02). Removing the utilities is more reliable
    // than a lint rule nobody runs on a template string.
    textTransform: false,
    letterSpacing: false,
  },
};
