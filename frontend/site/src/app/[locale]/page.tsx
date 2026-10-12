import { notFound } from 'next/navigation';

import { Landing } from '@/components/Landing';
import { copy } from '@/content/copy';
import { SITE_ORIGIN } from '@/content/site';

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export function generateStaticParams(): { locale: string }[] {
  return [{ locale: 'bn' }, { locale: 'en' }];
}

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (locale !== 'bn' && locale !== 'en') return {};
  const t = copy[locale];
  return {
    metadataBase: new URL(SITE_ORIGIN),
    title: t.title,
    description: t.description,
    alternates: {
      canonical: `/${locale}`,
      languages: { bn: '/bn', en: '/en', 'x-default': '/bn' },
    },
    openGraph: {
      type: 'website',
      siteName: 'MedLiveBD',
      url: `/${locale}`,
      title: t.title,
      description: t.description,
      locale: locale === 'bn' ? 'bn_BD' : 'en_US',
      alternateLocale: locale === 'bn' ? 'en_US' : 'bn_BD',
    },
    twitter: { card: 'summary_large_image', title: t.title, description: t.description },
  };
}

export default async function CompanyPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}): Promise<ReactNode> {
  const { locale } = await params;
  if (locale !== 'bn' && locale !== 'en') notFound();
  return <Landing locale={locale} />;
}
