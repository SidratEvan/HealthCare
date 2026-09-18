/**
 * `/` — the reception console (`S-B-02`).
 *
 * A client component in full. Every part of this screen is live: the queue
 * arrives over a socket, actions are applied optimistically against a local
 * queue, and the whole thing has to keep working with the network gone
 * (`FR-OFF-01`). None of that survives server rendering, and pretending
 * otherwise would mean a first paint showing a queue that is already wrong.
 */

'use client';

import { ReceptionConsole } from '@/components/ReceptionConsole';

import type { ReactNode } from 'react';

export default function Page(): ReactNode {
  return <ReceptionConsole />;
}
