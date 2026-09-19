'use client';

/**
 * `/s` — where an SMS tracking link lands (`FR-GST-05`, `S-A-08`).
 *
 * The URL is `/s?b=<bookingId>&t=<token>`, minted by `booking.service` and
 * delivered by SMS. `t` is the credential; `b` is there so a person reading
 * the message can see which booking it is about and so a support conversation
 * has something to name.
 *
 * A client component in full. Every figure on this screen arrives over a
 * socket, and server-rendering it would produce a first paint showing a queue
 * that has already moved.
 *
 * The token is read after mount rather than during render: the server has no
 * `location`, and reading it while rendering makes the first client render
 * disagree with the server's.
 */

import { useEffect, useState } from 'react';

import { LiveSerial } from '@/components/LiveSerial';

import type { ReactNode } from 'react';

export default function LiveSerialPage(): ReactNode {
  const [token, setToken] = useState<string | null>(null);
  const [read, setRead] = useState(false);

  useEffect(() => {
    setToken(new URLSearchParams(globalThis.location.search).get('t'));
    setRead(true);
  }, []);

  // Nothing renders until the URL has been read, so the screen does not flash
  // "this link is not valid" for one frame before finding the token that is
  // right there in the address bar.
  if (!read) return null;

  return <LiveSerial linkToken={token} />;
}
