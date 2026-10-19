import { notFound } from 'next/navigation';

import { Home } from '@/components/home/Home';
import { copy } from '@/content/copy';
import { LOCALES, pageMetadata } from '@/content/site';

export function generateStaticParams() {
  return LOCALES;
}

export async function generateMetadata({ params }) {
  const { locale } = await params;
  if (locale !== 'bn' && locale !== 'en') return {};
  return pageMetadata(locale, '', copy[locale].title, copy[locale].description);
}

export default async function CompanyPage({ params }) {
  const { locale } = await params;
  if (locale !== 'bn' && locale !== 'en') notFound();
  return <Home locale={locale} />;
}
