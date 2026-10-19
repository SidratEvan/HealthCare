import { Page } from '../Page';

import { Closing } from './Closing';
import { ForHospitals } from './ForHospitals';
import { ForPatients } from './ForPatients';
import { Hero } from './Hero';
import { Idea } from './Idea';
import { People } from './People';
import { Vision } from './Vision';

/**
 * The company homepage (S-C-01–05), redesigned 12 October 2026: who MedLiveBD
 * is and where each audience goes next, told in seven scenes.
 */
export function Home({ locale }) {
  return (
    <Page locale={locale} page="home">
      <Hero locale={locale} />
      <Idea locale={locale} />
      <ForHospitals locale={locale} />
      <ForPatients locale={locale} />
      <Vision locale={locale} />
      <People locale={locale} />
      <Closing locale={locale} />
    </Page>
  );
}
