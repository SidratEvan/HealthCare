/**
 * Which live figures a hospital shares (`FR-NET-04`; plan C5).
 */

import { describe, expect, it } from 'vitest';

import {
  MODULE_OF_FIGURE,
  PUBLISHABLE_FIGURES,
  isPublishableFigure,
  notSharedOf,
  publishingBody,
} from '../publishing.js';

describe('the figures a hospital may keep to itself', () => {
  it('are open serials, beds and medicine stock, and nothing else', () => {
    expect([...PUBLISHABLE_FIGURES].sort()).toEqual(['beds', 'serials', 'stock']);
    // What an emergency department can treat is not one of them.
    expect(isPublishableFigure('emergency')).toBe(false);
    expect(isPublishableFigure('capabilities')).toBe(false);
    expect(isPublishableFigure('beds')).toBe(true);
  });

  it('each comes from a module', () => {
    expect(MODULE_OF_FIGURE).toEqual({ serials: 'queue', beds: 'beds', stock: 'pharmacy' });
  });
});

describe('not shared is not the same as not run', () => {
  it('a figure is not shared where the hospital has it and withholds it', () => {
    expect(notSharedOf(['beds'], [])).toEqual(['beds']);
    expect(notSharedOf(['beds', 'serials', 'stock'], [])).toEqual(['serials', 'beds', 'stock']);
    expect(notSharedOf([], [])).toEqual([]);
  });

  it('where the module is off there is no figure, and nothing is said of it', () => {
    expect(notSharedOf(['beds'], ['beds'])).toEqual([]);
    expect(notSharedOf(['beds', 'stock'], ['pharmacy'])).toEqual(['beds']);
    expect(notSharedOf(['serials'], ['queue', 'doctor'])).toEqual([]);
  });

  it('a name that is no figure is ignored, not passed on', () => {
    expect(notSharedOf(['beds', 'takings'], [])).toEqual(['beds']);
  });
});

describe('a body is the figures withheld, each once', () => {
  it('and nothing else', () => {
    expect(publishingBody.safeParse({ unpublished: [] }).success).toBe(true);
    expect(publishingBody.safeParse({ unpublished: ['beds', 'stock'] }).success).toBe(true);
    expect(publishingBody.safeParse({ unpublished: ['beds', 'beds'] }).success).toBe(false);
    expect(publishingBody.safeParse({ unpublished: ['emergency'] }).success).toBe(false);
    expect(publishingBody.safeParse({ unpublished: ['beds'], also: 1 }).success).toBe(false);
    expect(publishingBody.safeParse({}).success).toBe(false);
  });
});
