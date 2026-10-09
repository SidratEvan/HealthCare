'use client';

/**
 * `/s` — where an SMS tracking link lands (`FR-GST-05`, `S-A-08`).
 *
 * The URL is `/s?b=<bookingId>&t=<token>`, minted by `booking.service` and
 * delivered by SMS. `t` is the credential; `b` is there so a person reading
 * the message can see which booking it is about and so a support conversation
 * has something to name.
 *
 * ## Opened without a link, by its owner (plan F1)
 *
 * A signed-in patient's serials are listed by the server, on any phone, and a
 * phone that did not make a booking holds no link for it. So `/s?b=<id>` with
 * no `t`, opened by somebody signed in, asks the server for a link to that
 * booking (`POST /me/bookings/:id/link`), which it gives for the account's
 * own bookings only; the phone keeps it and the address becomes the ordinary
 * one. Anybody else opening an address with no `t` is told what they always
 * were: this link is not valid.
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

import { tp } from '@platform/i18n';
import { useLocale } from '@platform/ui';

import { LiveSerial } from '@/components/LiveSerial';
import { SkeletonCards } from '@/components/States';
import { TabScreen } from '@/components/TabScreen';
import { linkForBooking, readAccount } from '@/lib/account';
import { linkHeldFor } from '@/lib/bookings';

import type { ReactNode } from 'react';

export default function LiveSerialPage(): ReactNode {
  const locale = useLocale();
  const [token, setToken] = useState<string | null>(null);
  const [read, setRead] = useState(false);
  // The server is being asked for a link: the one wait this page has of its own.
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(globalThis.location.search);
    const given = params.get('t');
    const bookingId = params.get('b');

    if (given !== null || bookingId === null || bookingId === '') {
      setToken(given);
      setRead(true);
      return undefined;
    }

    // No link in the address. One this phone already holds for the booking
    // is used; otherwise its owner, signed in, asks for one.
    let stale = false;
    const settle = (found: string | null): void => {
      if (stale) return;
      if (found !== null && found !== '') {
        globalThis.history.replaceState(
          null,
          '',
          `/s?b=${bookingId}&t=${encodeURIComponent(found)}`,
        );
      }
      setToken(found === '' ? null : found);
      setRead(true);
    };

    const held = linkHeldFor(bookingId);
    if (held !== null || readAccount() === null) {
      settle(held);
      return undefined;
    }
    setAsking(true);
    void linkForBooking(bookingId).then((asked) => {
      settle(asked.ok ? asked.value : null);
    });
    return () => {
      stale = true;
    };
  }, []);

  // Nothing renders until the URL has been read, so the screen does not flash
  // "this link is not valid" for one frame before finding the token that is
  // right there in the address bar. While a link is being asked for, the
  // shape of the screen, never a blank one (`GR-03`).
  if (!read) {
    return asking ? (
      <TabScreen title={tp('homeMySerial', locale)} back={{ fallback: '/serials' }}>
        <div aria-busy="true" data-testid="live-serial-asking">
          <SkeletonCards count={2} height={140} />
        </div>
      </TabScreen>
    ) : null;
  }

  return <LiveSerial linkToken={token} />;
}
