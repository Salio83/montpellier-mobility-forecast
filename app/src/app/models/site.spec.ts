import { isFresh, Site } from './site';

const now = new Date('2026-10-15T08:30:00Z');

function site(kind: Site['kind'], observedAt: string | null): Site {
  return {
    id: 'x',
    kind,
    name: 'x',
    lat: 0,
    lon: 0,
    available: null,
    capacity: null,
    dailyCount: null,
    status: null,
    observedAt: observedAt ? new Date(observedAt) : null,
  };
}

describe('isFresh', () => {
  it('hides a site that never published a live value', () => {
    expect(isFresh(site('parking', null), now)).toBe(false);
  });

  it('uses 1 hour for car parks (P-005 was 17 days late)', () => {
    expect(isFresh(site('parking', '2026-10-15T08:00:00Z'), now)).toBe(true);
    expect(isFresh(site('parking', '2026-09-28T00:00:00Z'), now)).toBe(false);
  });

  it('uses 48 hours for counters, published up to 35 hours late', () => {
    expect(isFresh(site('counter', '2026-10-13T21:00:00Z'), now)).toBe(true); // 35.5 h
    expect(isFresh(site('counter', '2026-10-13T03:00:00Z'), now)).toBe(false); // 53.5 h
  });
});
