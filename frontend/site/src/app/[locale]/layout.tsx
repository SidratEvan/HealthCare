import { notFound } from 'next/navigation';

import { fontVariables } from '../fonts';

import '../site.css';

import type { ReactNode } from 'react';

/** Server-rendered document language, including without JavaScript (GR-06). */
export default async function LocaleLayout({
  children,
  params,
}: {
  readonly children: ReactNode;
  readonly params: Promise<{ locale: string }>;
}): Promise<ReactNode> {
  const { locale } = await params;
  if (locale !== 'bn' && locale !== 'en') notFound();
  return (
    <html lang={locale} className={fontVariables}>
      <body>{children}</body>
    </html>
  );
}
