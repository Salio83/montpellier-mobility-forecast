import { summarizeCounter, toSite } from './mobility-api.service';

// Shapes copied from real responses saved in data/raw/exploration/.
describe('toSite', () => {
  it('converts a bike station (name from address, [lon, lat] order)', () => {
    const site = toSite('bike', {
      id: 'urn:ngsi-ld:station:006',
      address: { value: { streetAddress: 'Place Albert 1er - St Charles' } },
      location: { value: { coordinates: [3.873375, 43.616768] } },
      status: { value: 'working', observedAt: '2026-10-13T13:13:47.000Z' },
      availableBikeNumber: { value: 2, observedAt: '2026-10-13T13:13:47.000Z' },
      totalSlotNumber: { value: 27 },
    });
    expect(site.name).toBe('Place Albert 1er - St Charles');
    expect(site.lat).toBe(43.616768);
    expect(site.lon).toBe(3.873375);
    expect(site.available).toBe(2);
    expect(site.capacity).toBe(27);
    expect(site.observedAt?.toISOString()).toBe('2026-10-13T13:13:47.000Z');
  });

  it('keeps available = null for a car park without live data', () => {
    const site = toSite('parking', {
      id: 'urn:ngsi-ld:OffStreetParking:34172-P-010',
      name: { value: 'Some car park' },
      address: { value: 'rue Foch' },
      location: { value: { coordinates: [3.87, 43.61] } },
      totalSpotNumber: { value: 451 },
    });
    expect(site.available).toBeNull();
    expect(site.capacity).toBe(451);
    expect(site.observedAt).toBeNull();
  });

  it('falls back to the id suffix for a counter with an empty name', () => {
    const site = toSite('counter', {
      id: 'urn:ngsi-ld:EcoCounter:X2H20042633',
      name: { value: '' },
      location: { value: { coordinates: [3.86, 43.58] } },
    });
    expect(site.name).toBe('X2H20042633');
    expect(site.dailyCount).toBeNull();
    expect(site.observedAt).toBeNull(); // no reading: will be hidden
  });

  it('takes a counter time and total from its summary', () => {
    const observedAt = new Date('2026-10-14T23:00:00Z');
    const site = toSite(
      'counter',
      { id: 'urn:ngsi-ld:EcoCounter:A', location: { value: { coordinates: [3.86, 43.58] } } },
      { dailyCount: 812, observedAt },
    );
    expect(site.dailyCount).toBe(812);
    expect(site.observedAt).toEqual(observedAt);
  });
});

describe('summarizeCounter', () => {
  it('sums the 24 hourly readings up to the last one', () => {
    // 30 hourly readings of 10 bikes, from 2026-10-13T18:00Z to 2026-10-14T23:00Z.
    const values: [number, string][] = Array.from({ length: 30 }, (_, i) => [
      10,
      new Date(Date.UTC(2026, 9, 13, 18 + i)).toISOString(),
    ]);
    const summary = summarizeCounter(values);
    expect(summary?.dailyCount).toBe(240); // 24 readings, not 25 or 30
    expect(summary?.observedAt.toISOString()).toBe('2026-10-14T23:00:00.000Z');
  });

  it('returns null for a counter without readings', () => {
    expect(summarizeCounter([])).toBeNull();
  });
});
