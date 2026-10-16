export const SITE_URL = 'https://healthgraph.shop';
export const SITE_NAME = 'HealthGraph';
export const SITE_TAGLINE = 'Health, connected.';
export const SITE_DESCRIPTION =
  'HealthGraph connects pulse, sleep, meds, meals, cycle, documents and 3D body into one private on-device health graph. Free to start, free to keep.';

export function canonical(path = '/'): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  return `${SITE_URL}${clean === '/' ? '/' : clean}`;
}

export function organizationJsonLd(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url: SITE_URL,
    logo: `${SITE_URL}/logo.png`,
    sameAs: [],
  };
}

export function websiteJsonLd(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: SITE_URL,
    inLanguage: ['en', 'de'],
    description: SITE_DESCRIPTION,
  };
}

export function appJsonLd(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: SITE_NAME,
    applicationCategory: 'HealthApplication',
    operatingSystem: 'Android',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
    url: SITE_URL,
    description: SITE_DESCRIPTION,
  };
}
