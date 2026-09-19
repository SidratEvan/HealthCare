'use client';

import { tp } from '@platform/i18n';

import { NotBuiltYet } from '@/components/TabScreen';

import type { ReactNode } from 'react';

export default function Page(): ReactNode {
  return <NotBuiltYet title={tp('navRecords', 'bn')} explanation="recordsComing" />;
}
