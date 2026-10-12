import { notFound } from 'next/navigation';

import { Home } from '@/components/home/Home';
import { copy } from '@/content/copy';
import { LOCALES, pageMetadata } from '@/content/site';

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export function generateStaticParams(): { locale: string }[] {
  return LOCALES;
}

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (locale !== 'bn' && locale !== 'en') return {};
  return pageMetadata(locale, '', copy[locale].title, copy[locale].description);
}

export default async function CompanyPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}): Promise<ReactNode> {
  const { locale } = await params;
  if (locale !== 'bn' && locale !== 'en') notFound();
  return <Home locale={locale} />;
}
