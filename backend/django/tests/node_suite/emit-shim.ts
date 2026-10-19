/**
 * Stands in for `backend/api/src/realtime/emit.ts` in the Django run.
 *
 * Everything is the real module's (Node code a fixture calls still emits into
 * its own recorder), except `resetEmitter`: the recorder it returns reads what
 * the Django process emitted, from the test seam (`/__test__/emitted`). Reads
 * are synchronous because the original recorder's are, so each one runs a
 * short child process; the suite is slower for it and its assertions are
 * unchanged.
 */

import { execFileSync } from 'node:child_process';

import { DJANGO_API_URL } from './app-shim.js';

export * from '../../../api/src/realtime/emit.js';

interface Emission {
  readonly room: string;
  readonly event: string;
  readonly envelope: Record<string, unknown>;
}

function call(path: string, method: 'GET' | 'POST'): unknown {
  const script = `fetch(${JSON.stringify(`${DJANGO_API_URL}${path}`)}, { method: ${JSON.stringify(method)} })
    .then((r) => r.text()).then((t) => process.stdout.write(t), (e) => { console.error(e); process.exit(1); });`;
  const out = execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' });
  return (JSON.parse(out) as { data: unknown }).data;
}

export class DjangoRecordingEmitter {
  emit(): void {
    throw new Error(
      'The Django run records what the Django server emits; a test does not emit into it.',
    );
  }

  all(): readonly Emission[] {
    return call('/__test__/emitted', 'GET') as Emission[];
  }

  forRoom(room: string): readonly { event: string; envelope: Record<string, unknown> }[] {
    return this.all()
      .filter((entry) => entry.room === room)
      .map((entry) => ({ event: entry.event, envelope: entry.envelope }));
  }

  clear(): void {
    call('/__test__/emitted/reset', 'POST');
  }
}

export function resetEmitter(): DjangoRecordingEmitter {
  const recorder = new DjangoRecordingEmitter();
  recorder.clear();
  return recorder;
}
