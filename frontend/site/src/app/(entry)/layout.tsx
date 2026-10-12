import '../medlive.css';

import type { ReactNode } from 'react';

export default function EntryLayout({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <html lang="bn">
      <body>{children}</body>
    </html>
  );
}
