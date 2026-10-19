import { copy } from '@/content/copy';

import { Footer } from './Footer';
import { Header } from './Header';
import { MotionProvider } from './motion';

/** Every page's frame: skip link, header, main, footer, one motion engine. */
export function Page({ locale, page, children }) {
  return (
    <MotionProvider>
      <div className={`site page-${page}`} lang={locale} id="top">
        <a className="skip-link" href="#main">
          {copy[locale].skip}
        </a>
        <Header locale={locale} page={page} />
        <main id="main">{children}</main>
        <Footer locale={locale} page={page} />
      </div>
    </MotionProvider>
  );
}
