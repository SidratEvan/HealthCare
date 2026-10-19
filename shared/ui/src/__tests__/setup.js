/**
 * Setup for the rendered-component project.
 *
 * `@testing-library/jest-dom` adds the matchers these tests read best with
 * (`toBeDisabled`, `toHaveAccessibleName`, `toHaveFocus`), and the cleanup
 * keeps one test's DOM out of the next one's queries.
 */

import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
