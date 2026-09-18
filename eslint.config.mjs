// Root ESLint configuration.
//
// Rules live in shared/config so that every workspace shares one definition
// (FRONTEND.md §10: "shared/config — eslint, tsconfig, tailwind preset").
// This file only composes them, and the order matters:
//
//   base       the shared baseline, ending with Prettier's rule switch-off
//   layering   the architectural boundaries (BACKEND.md §3, CLAUDE.md §7)
//   overrides  narrow relaxations, last so nothing re-enables them
//
// Flat config replaces a rule's options rather than merging them, so moving
// `overrides` earlier would silently re-arm rules it exists to switch off.

import { base, overrides } from '@platform/config/eslint/base';
import { layering } from '@platform/config/eslint/layering';

export default [...base, ...layering, ...overrides];
