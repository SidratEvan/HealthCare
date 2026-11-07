// The watchdog: somebody is told when the server needs a person
// (FR-SUP-06, its last sentence; DEPLOY.md §S5a; MARKS readiness F-07).
//
// `/readyz` already says what is wrong, in fixed words (plan I2): a backup
// that failed, went stale or never ran, messages due and unsent, a timer that
// stopped. Until now nobody was told: it was there to be read. This reads it
// every minute and posts to ALERT_WEBHOOK_URL when something goes wrong, when
// what is wrong changes, every ALERT_REPEAT_HOURS while it stays wrong, and
// when it is right again. Optionally once a day it says all is well, so that a
// watchdog that has itself stopped is noticed by its silence.
//
// No patient data can be in a message: `/readyz` carries none, and nothing
// else is read. Node's own modules only, run from the API's image, so the
// stack gains no dependency.
//
//   node deploy/watchdog.mjs         every WATCHDOG_INTERVAL_SECONDS, for ever
//   node deploy/watchdog.mjs once    one check, then exit (its test, and by hand)
//
// The webhook is a plain HTTPS POST. With ALERT_WEBHOOK_FORMAT=json (the
// default) the body is {"text": …, "content": …}, which Telegram's sendMessage
// (chat_id in the URL), Slack and Discord accept; with =text the body is the
// message itself, which ntfy accepts.

/* global fetch, AbortSignal, setTimeout -- Node's own (18 and later). */

import { readFileSync, writeFileSync } from 'node:fs';

const env = process.env;
const READYZ_URL = env.WATCHDOG_READYZ_URL || 'http://api:4000/readyz';
const INTERVAL_SECONDS = positive(env.WATCHDOG_INTERVAL_SECONDS, 60);
// An API restarting is unreachable for a minute; three misses in a row is not
// a restart.
const MISSES_BEFORE_ALERT = positive(env.WATCHDOG_MISSES_BEFORE_ALERT, 3);
const STATE_FILE = env.WATCHDOG_STATE_FILE || '/tmp/medlivebd-watchdog.json';
const WEBHOOK_URL = env.ALERT_WEBHOOK_URL || '';
const WEBHOOK_FORMAT = env.ALERT_WEBHOOK_FORMAT === 'text' ? 'text' : 'json';
const REPEAT_HOURS = positive(env.ALERT_REPEAT_HOURS, 6);
const SERVER_NAME = env.ALERT_SERVER_NAME || 'MedLiveBD server';
// Blank: no daily message. 3 is 09:00 in Dhaka.
const DAILY_UTC_HOUR =
  env.ALERT_DAILY_UTC_HOUR === undefined || env.ALERT_DAILY_UTC_HOUR === ''
    ? null
    : Number(env.ALERT_DAILY_UTC_HOUR);

/** What each word means to whoever is called. Unknown words are passed on as they are. */
const MEANING = {
  api_unreachable: 'The API is not answering.',
  database_unreachable: 'The API cannot reach the database.',
  backup_failed:
    "Last night's backup failed. `docker compose exec backup sh /deploy/backup.sh check` says why.",
  backup_stale: 'There has been no good backup within the allowed age.',
  backup_none: 'No backup has ever completed on this server.',
  messages_overdue: 'Messages to patients are due and have not been sent.',
  worker_late: 'Work the server does on a clock (sessions, timers) has stopped running.',
};

function positive(raw, fallback) {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** The clock, which the test may fix. */
function now() {
  return env.WATCHDOG_NOW ? Number(env.WATCHDOG_NOW) * 1000 : Date.now();
}

function readState() {
  try {
    const state = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    if (state && Array.isArray(state.problems)) return state;
  } catch {
    // No state yet, or it was unreadable: start as if all were well.
  }
  return { problems: [], since: null, lastSentAt: null, misses: 0, lastDailyDay: null };
}

function writeState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state));
}

/** What is wrong right now, as words; empty when nothing is. */
async function look(misses) {
  let body;
  try {
    const response = await fetch(READYZ_URL, { signal: AbortSignal.timeout(10_000) });
    // `{ ok, data }`, the API's envelope (BACKEND.md §9).
    body = (await response.json())?.data;
  } catch {
    const count = misses + 1;
    return { problems: count >= MISSES_BEFORE_ALERT ? ['api_unreachable'] : null, misses: count };
  }
  if (body?.status !== 'ready' || body?.checks?.database?.ok !== true) {
    return { problems: ['database_unreachable'], misses: 0 };
  }
  const attention = Array.isArray(body?.signals?.attention)
    ? body.signals.attention.filter((word) => typeof word === 'string')
    : [];
  return { problems: attention, misses: 0 };
}

function describe(problems) {
  return problems.map((word) => `- ${MEANING[word] ?? word}`).join('\n');
}

function stamp(ms) {
  return `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

async function send(text) {
  if (WEBHOOK_URL === '') {
    console.log(`[watchdog] ALERT_WEBHOOK_URL is not set; not sent:\n${text}`);
    return true;
  }
  try {
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'content-type':
          WEBHOOK_FORMAT === 'json' ? 'application/json' : 'text/plain; charset=utf-8',
      },
      body: WEBHOOK_FORMAT === 'json' ? JSON.stringify({ text, content: text }) : text,
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      console.log(`[watchdog] the webhook answered ${response.status}; will try again`);
      return false;
    }
    return true;
  } catch {
    // The URL is a credential (a bot token, a topic); it is never logged.
    console.log('[watchdog] the webhook could not be reached; will try again');
    return false;
  }
}

async function checkOnce() {
  const state = readState();
  const at = now();
  const seen = await look(state.misses);
  state.misses = seen.misses;

  // Missed once or twice: neither well nor ill yet; keep what was.
  const problems = seen.problems ?? state.problems;
  const before = state.problems.join(',');
  const after = problems.join(',');

  let message = null;
  if (before === '' && after !== '') {
    message = `${SERVER_NAME}: needs attention (since ${stamp(at)})\n${describe(problems)}`;
  } else if (before !== '' && after === '') {
    message = `${SERVER_NAME}: all well again at ${stamp(at)} (the problem began ${stamp(state.since)}).`;
  } else if (after !== '' && after !== before) {
    message = `${SERVER_NAME}: what needs attention has changed (${stamp(at)})\n${describe(problems)}`;
  } else if (after !== '' && at - (state.lastSentAt ?? 0) >= REPEAT_HOURS * 3_600_000) {
    message = `${SERVER_NAME}: still needs attention, since ${stamp(state.since)}\n${describe(problems)}`;
  } else if (after === '' && DAILY_UTC_HOUR !== null) {
    const day = new Date(at).toISOString().slice(0, 10);
    if (new Date(at).getUTCHours() >= DAILY_UTC_HOUR && state.lastDailyDay !== day) {
      if (
        await send(
          `${SERVER_NAME}: all well (${stamp(at)}). This is the daily message; its absence means the watchdog has stopped.`,
        )
      ) {
        state.lastDailyDay = day;
      }
    }
  }

  if (message !== null) {
    // Only a message that went out moves the state on; one that did not is
    // tried again at the next check.
    if (await send(message)) {
      if (before === '' || after === '') state.since = after === '' ? null : at;
      state.problems = problems;
      state.lastSentAt = at;
    }
  }
  writeState(state);
  return state;
}

async function main() {
  const once = process.argv[2] === 'once';
  console.log(
    `[watchdog] watching ${READYZ_URL}${WEBHOOK_URL === '' ? ' (no ALERT_WEBHOOK_URL: alerts go to this log only)' : ''}`,
  );
  for (;;) {
    try {
      await checkOnce();
    } catch (error) {
      console.log(
        `[watchdog] the check itself failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
    if (once) return;
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_SECONDS * 1000));
  }
}

await main();
