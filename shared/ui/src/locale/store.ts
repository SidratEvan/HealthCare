/**
 * Which language this device is reading in (`GR-06`, `I18N-08`).
 *
 * One value for the whole app, held outside React and read through
 * `useSyncExternalStore`, so that every screen, sheet and toast re-renders in
 * the same commit when the switch is pressed — `I18N-08`: "switching applies
 * instantly without reload". A context provider would do the same for the
 * tree beneath it and nothing outside it; a module store has no outside.
 *
 * ## Where the choice lives
 *
 * `localStorage`, on this device. Accounts are deferred (`CLAUDE.md` §4.1),
 * so there is nowhere else to keep a patient's preference, and a guest's
 * language cannot follow them to their SMS yet — `FR-PAT-05` stores it per
 * account. A counter's console is one browser on one desk, which is exactly
 * what device storage describes.
 *
 * ## Server rendering
 *
 * The server has no storage, so it renders Bangla — the default (`FR-LOC-01`)
 * — and React re-renders into the stored choice immediately after hydrating.
 * Reading storage during the first render instead would make the client's
 * first render disagree with the server's HTML.
 */

'use client';

import { useSyncExternalStore } from 'react';

import { DEFAULT_LOCALE, isLocale, type Locale } from '@platform/i18n';

export const LOCALE_STORAGE_KEY = 'platform.locale';

const listeners = new Set<() => void>();

/** Read once, then kept in step by `setLocale` and the `storage` event. */
let current: Locale | null = null;

function readStored(): Locale {
  try {
    const value = globalThis.localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(value) ? value : DEFAULT_LOCALE;
  } catch {
    // Storage refused (a private window, a locked-down browser): the default
    // is the honest answer, not an error.
    return DEFAULT_LOCALE;
  }
}

function snapshot(): Locale {
  current ??= readStored();
  return current;
}

function serverSnapshot(): Locale {
  return DEFAULT_LOCALE;
}

function notify(): void {
  for (const listener of listeners) listener();
}

/**
 * Another tab changed the language.
 *
 * A reception desk often has the console open twice — the queue and the
 * picker — and a language that differed between two tabs of one app would
 * read as a bug.
 */
function onStorage(event: StorageEvent): void {
  if (event.key !== null && event.key !== LOCALE_STORAGE_KEY) return;
  const next = readStored();
  if (next === current) return;
  current = next;
  notify();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) globalThis.addEventListener('storage', onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) globalThis.removeEventListener('storage', onStorage);
  };
}

/** The language this device reads in. Bangla until somebody chooses otherwise. */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

/**
 * Chooses a language, for every screen at once, and remembers it.
 *
 * A storage failure still switches the screen: the choice then lasts until
 * the page is closed, which is better than a button that does nothing.
 */
export function setLocale(next: Locale): void {
  try {
    globalThis.localStorage.setItem(LOCALE_STORAGE_KEY, next);
  } catch {
    // See `readStored`.
  }
  if (next === current) return;
  current = next;
  notify();
}
