// Statistics computed from the aggregated series of the API. Pure functions:
// no HTTP, no Angular, so each rule can be tested and explained on its own.

import { Site } from '../models/site';

// ---- Input series (built by MobilityApiService) -------------------------

/** One counter on one UTC day (server-side sum over the day). */
export interface CounterDay {
  counterId: string;
  name: string;
  date: string; // UTC day, 'YYYY-MM-DD'
  count: number; // bikes counted that day
  readings: number; // hourly readings that day (24 when complete)
}

/** One car park, hourly average of its free spots. */
export interface ParkingSeries {
  id: string;
  name: string;
  capacity: number | null;
  hours: { start: Date; available: number }[];
}

/** One bike station, min and max of available bikes per hour. */
export interface StationSeries {
  id: string;
  name: string;
  capacity: number | null;
  hours: { start: Date; min: number; max: number }[];
}

// ---- Time helpers ---------------------------------------------------------

const PARIS = 'Europe/Paris';
const hourFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: PARIS,
  hour: 'numeric',
  hourCycle: 'h23',
});

/** Hour of the day in Paris (0 to 23). Handles daylight-saving changes. */
export function parisHour(date: Date): number {
  return Number(hourFormat.format(date));
}

const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: PARIS }); // 'YYYY-MM-DD'

/** Calendar day in Paris, 'YYYY-MM-DD'. */
export function parisDay(date: Date): string {
  return dayFormat.format(date);
}

/** Monday = 0 ... Sunday = 6, for a 'YYYY-MM-DD' day. */
export function weekdayOf(day: string): number {
  return (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
}

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ---- Bike traffic (counters) ---------------------------------------------
//
// Method (D14): each counter is compared with ITSELF. The set of counters
// with a complete day changes a lot from one date to the next (14 to 51 on
// 2026-09-17..10-14), and counters differ a lot in size (Gambetta ~4,600
// bikes/day, many under 500). A mean in bikes per counter therefore depends on
// which counters reported. An index does not: a counter at 120 had 20 % more
// bikes than on its typical day, whatever its size.

// A day counts only with its 24 hourly readings. Otherwise an outage would
// look like a quiet day (most counter-days have 24, some only 1 to 23).
export const READINGS_PER_FULL_DAY = 24;
// A counter needs this many complete days for its typical day to mean something.
export const MIN_DAYS_FOR_BASELINE = 7;
// A date is shown only with this many counters. Counters are published up to
// 35 h late: on 2026-10-15, the day before had a single complete counter.
export const MIN_COUNTERS_PER_DATE = 10;

export function completeDays(days: CounterDay[]): CounterDay[] {
  return days.filter((d) => d.readings >= READINGS_PER_FULL_DAY);
}

/** Typical day of each counter: median of its complete days. */
export function counterBaselines(days: CounterDay[]): Map<string, number> {
  const byCounter = new Map<string, number[]>();
  for (const d of completeDays(days)) {
    byCounter.set(d.counterId, [...(byCounter.get(d.counterId) ?? []), d.count]);
  }
  const baselines = new Map<string, number>();
  for (const [id, counts] of byCounter) {
    const typical = median(counts)!;
    // A zero baseline cannot divide (a counter that counts nothing).
    if (counts.length >= MIN_DAYS_FOR_BASELINE && typical > 0) baselines.set(id, typical);
  }
  return baselines;
}

/** Ratio of each complete counter-day to that counter's typical day. */
function ratiosByDate(days: CounterDay[]): Map<string, number[]> {
  const baselines = counterBaselines(days);
  const byDate = new Map<string, number[]>();
  for (const d of completeDays(days)) {
    const baseline = baselines.get(d.counterId);
    if (baseline === undefined) continue;
    byDate.set(d.date, [...(byDate.get(d.date) ?? []), d.count / baseline]);
  }
  return byDate;
}

/**
 * Traffic index for every date between the first and the last one: median
 * over the counters of (bikes that day / counter's typical day). 1 = typical.
 * null when fewer than MIN_COUNTERS_PER_DATE counters reported, so the chart
 * shows a gap instead of hiding the date.
 */
export function dailyIndex(
  days: CounterDay[],
): { date: string; index: number | null; counters: number }[] {
  const byDate = ratiosByDate(days);
  const dates = [...byDate.keys()].sort();
  if (!dates.length) return [];
  const result: { date: string; index: number | null; counters: number }[] = [];
  for (let date = dates[0]; date <= dates.at(-1)!; date = nextDay(date)) {
    const ratios = byDate.get(date) ?? [];
    const enough = ratios.length >= MIN_COUNTERS_PER_DATE;
    result.push({ date, index: enough ? median(ratios) : null, counters: ratios.length });
  }
  return result;
}

/** Traffic index for each weekday (Monday first): median over all its counter-days. */
export function weekdayIndexes(days: CounterDay[]): (number | null)[] {
  const byWeekday: number[][] = WEEKDAYS.map(() => []);
  for (const [date, ratios] of ratiosByDate(days)) {
    if (ratios.length >= MIN_COUNTERS_PER_DATE) byWeekday[weekdayOf(date)].push(...ratios);
  }
  return byWeekday.map(median);
}

/** Counters ranked by mean bikes per complete day (real bikes, not an index). */
export function topCounters(
  days: CounterDay[],
  limit = 10,
): { name: string; meanPerDay: number; days: number }[] {
  const byCounter = new Map<string, { name: string; counts: number[] }>();
  for (const d of completeDays(days)) {
    const entry = byCounter.get(d.counterId) ?? { name: d.name, counts: [] };
    entry.counts.push(d.count);
    byCounter.set(d.counterId, entry);
  }
  return [...byCounter.values()]
    .map(({ name, counts }) => ({ name, meanPerDay: mean(counts)!, days: counts.length }))
    .sort((a, b) => b.meanPerDay - a.meanPerDay)
    .slice(0, limit);
}

function nextDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

// ---- Car parks ------------------------------------------------------------

/** Occupancy of one hour: share of spots taken, from 0 to 1. */
export function occupancy(available: number, capacity: number): number {
  return 1 - available / capacity;
}

/**
 * Car parks whose data agrees with their capacity. One hour with more free
 * spots than the capacity means the listed capacity is wrong (on 2026-10-15,
 * Charles de Gaulle listed 50 spots and published up to 109 free), so the
 * whole car park is left out, not just the impossible hours: the other hours
 * would be computed with the same wrong capacity.
 */
export function reliableParkings(parkings: ParkingSeries[]): {
  kept: (ParkingSeries & { capacity: number })[];
  rejected: string[];
} {
  const kept: (ParkingSeries & { capacity: number })[] = [];
  const rejected: string[] = [];
  for (const p of parkings) {
    const capacity = p.capacity;
    const consistent =
      capacity !== null &&
      capacity > 0 &&
      p.hours.every((h) => h.available >= 0 && h.available <= capacity);
    if (consistent) kept.push({ ...p, capacity });
    else rejected.push(p.name);
  }
  return { kept, rejected };
}

/**
 * Mean occupancy for each hour of the day (Paris time), separately for
 * weekdays and weekends. Each car park counts as much as the others, whatever
 * its size.
 */
export function hourlyOccupancyProfile(parkings: (ParkingSeries & { capacity: number })[]): {
  weekday: (number | null)[];
  weekend: (number | null)[];
} {
  const weekday: number[][] = Array.from({ length: 24 }, () => []);
  const weekend: number[][] = Array.from({ length: 24 }, () => []);
  for (const p of parkings) {
    for (const h of p.hours) {
      const day = parisDay(h.start);
      (weekdayOf(day) >= 5 ? weekend : weekday)[parisHour(h.start)].push(
        occupancy(h.available, p.capacity),
      );
    }
  }
  return { weekday: weekday.map(mean), weekend: weekend.map(mean) };
}

/** Car parks ranked by mean occupancy over the period. */
export function busiestParkings(
  parkings: (ParkingSeries & { capacity: number })[],
  limit = 10,
): { name: string; occupancy: number; capacity: number }[] {
  return parkings
    .map((p) => ({
      name: p.name,
      capacity: p.capacity,
      occupancy: mean(p.hours.map((h) => occupancy(h.available, p.capacity))),
    }))
    .filter((p): p is { name: string; capacity: number; occupancy: number } => p.occupancy !== null)
    .sort((a, b) => b.occupancy - a.occupancy)
    .slice(0, limit);
}

// ---- Bike stations --------------------------------------------------------

/**
 * Share of hours a station stayed empty (max = 0) or full (min = capacity)
 * for the WHOLE hour. A station empty for 50 minutes is not counted, so these
 * shares are a lower bound of the time spent empty or full.
 */
export function emptyFullShares(
  stations: StationSeries[],
): { name: string; capacity: number; empty: number; full: number; hours: number }[] {
  return stations
    .filter((s) => s.hours.length > 0 && s.capacity)
    .map((s) => ({
      name: s.name,
      capacity: s.capacity!,
      hours: s.hours.length,
      empty: s.hours.filter((h) => h.max === 0).length / s.hours.length,
      full: s.hours.filter((h) => h.min >= s.capacity!).length / s.hours.length,
    }));
}

// ---- Current state (from the live sites) ----------------------------------

export interface CurrentFigures {
  bikesAvailable: number;
  bikeSlots: number;
  stationsEmpty: number;
  stationsFull: number;
  stations: number;
  freeSpots: number;
  parkingSpots: number;
  parkings: number;
}

/** Totals over the fresh sites only (stale sites are hidden, see D13). */
export function currentFigures(freshSites: Site[]): CurrentFigures {
  const stations = freshSites.filter((s) => s.kind === 'bike' && s.available !== null);
  const parkings = freshSites.filter((s) => s.kind === 'parking' && s.available !== null);
  const sum = (sites: Site[], key: 'available' | 'capacity') =>
    sites.reduce((total, s) => total + (s[key] ?? 0), 0);
  return {
    bikesAvailable: sum(stations, 'available'),
    bikeSlots: sum(stations, 'capacity'),
    stationsEmpty: stations.filter((s) => s.available === 0).length,
    stationsFull: stations.filter((s) => s.capacity !== null && s.available! >= s.capacity).length,
    stations: stations.length,
    freeSpots: sum(parkings, 'available'),
    parkingSpots: sum(parkings, 'capacity'),
    parkings: parkings.length,
  };
}
