// One point on the map, whatever its source type. The service converts the
// NGSI-LD entities into this shape, so components never read raw API JSON.

export type SiteKind = 'bike' | 'parking' | 'counter';

export interface Site {
  id: string; // full NGSI-LD id
  kind: SiteKind;
  name: string;
  lat: number;
  lon: number;
  // Live values. null when the entity publishes none (18 parkings have no
  // space guidance system).
  available: number | null; // bikes (bike), free spots (parking)
  capacity: number | null; // total slots (bike), total spots (parking)
  // Counters only: bikes counted in the 24 hours up to the last reading.
  dailyCount: number | null;
  status: string | null; // 'working', 'Open', 'Full'...
  observedAt: Date | null; // time of the last live value
}

export const KIND_LABELS: Record<SiteKind, string> = {
  bike: 'Vélomagg stations',
  parking: 'Car parks',
  counter: 'Bike counters',
};

// A site older than this is hidden. Measured on 2026-10-15 (see D13): bike
// stations are under 2 minutes old and car parks under 5, but counters are
// published in batches 9 to 35 hours late even when they work.
export const MAX_AGE_HOURS: Record<SiteKind, number> = {
  bike: 1,
  parking: 1,
  counter: 48,
};

/** True when the site has a live value recent enough to be shown. */
export function isFresh(site: Site, now: Date): boolean {
  if (!site.observedAt) return false;
  const ageHours = (now.getTime() - site.observedAt.getTime()) / 3_600_000;
  return ageHours <= MAX_AGE_HOURS[site.kind];
}

/** The value that sets the marker size: what the site "weighs". */
export function volume(site: Site): number | null {
  return site.kind === 'counter' ? site.dailyCount : site.capacity;
}
