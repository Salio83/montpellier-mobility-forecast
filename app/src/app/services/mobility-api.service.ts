import { HttpClient } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import { forkJoin, map, Observable } from 'rxjs';
import { Site, SiteKind } from '../models/site';
import { CounterDay, ParkingSeries, StationSeries } from '../stats/stats';

// Temporary data source: the Montpellier open data API, called from the
// browser (it sends Access-Control-Allow-Origin: *). When the FastAPI backend
// exists (decision D7), only this service has to change.
const BASE_URL = 'https://portail-api-data.montpellier.fr/ngsi-ld/v1';

// Counter readings asked for: 48 h (freshness limit) + 24 h (daily total).
// About 3,800 points for all counters, under the 10,000-point cap.
const COUNTER_WINDOW_HOURS = 72;

// Minimal typing of the NGSI-LD fields we read. Every attribute is wrapped:
// {"type": "Property", "value": ..., "observedAt": ...}.
interface Property<T> {
  value: T;
  observedAt?: string;
}
interface NgsiEntity {
  id: string;
  name?: Property<string>;
  address?: Property<string | { streetAddress?: string }>;
  location: { value: { coordinates: [number, number] } }; // GeoJSON: [lon, lat]
  status?: Property<string>;
  availableBikeNumber?: Property<number>;
  totalSlotNumber?: Property<number>;
  availableSpotNumber?: Property<number>;
  totalSpotNumber?: Property<number>;
}
// format=temporalValues: [[value, timestamp], ...], oldest first.
interface TemporalEntity {
  id: string;
  intensity?: { values: [number, string][] };
}
// format=aggregatedValues: one [value, bucketStart, bucketEnd] per bucket and
// method. Buckets without data are omitted (api-findings.md, section 3).
type Buckets = [number, string, string][];
type AggregatedEntity = { id: string } & Record<string, { [method: string]: Buckets } | undefined>;

export interface CounterSummary {
  dailyCount: number;
  observedAt: Date;
}

const NGSI_TYPES: Record<SiteKind, string> = {
  bike: 'BikeHireDockingStation',
  parking: 'OffStreetParking',
  counter: 'EcoCounter',
};

// @Service (Angular 22) = @Injectable({ providedIn: 'root' }): one shared instance.
@Service()
export class MobilityApiService {
  private readonly http = inject(HttpClient);

  /** Current state of all stations, car parks and counters. */
  getSites(): Observable<Site[]> {
    // Four requests in parallel. All entity lists are below the 1,000 limit
    // (api-findings.md, section 2), so no pagination is needed.
    return forkJoin({
      bike: this.getEntities('bike'),
      parking: this.getEntities('parking'),
      counter: this.getEntities('counter'),
      readings: this.getCounterSummaries(),
    }).pipe(
      map(({ bike, parking, counter, readings }) => [
        ...bike.map((e) => toSite('bike', e)),
        ...parking.map((e) => toSite('parking', e)),
        ...counter.map((e) => toSite('counter', e, readings.get(e.id))),
      ]),
    );
  }

  private getEntities(kind: SiteKind): Observable<NgsiEntity[]> {
    const params = { type: NGSI_TYPES[kind], limit: 1000 };
    return this.http.get<NgsiEntity[]>(`${BASE_URL}/entities`, { params });
  }

  // The entity list has no counter readings, so ask the temporal endpoint for
  // all counters in one request. A counter with no reading in the window is
  // absent from the answer.
  private getCounterSummaries(): Observable<Map<string, CounterSummary>> {
    const since = new Date(Date.now() - COUNTER_WINDOW_HOURS * 3_600_000);
    const params = {
      type: NGSI_TYPES.counter,
      attrs: 'intensity',
      timerel: 'after',
      timeAt: since.toISOString(),
      format: 'temporalValues',
      limit: 1000,
    };
    return this.getTemporal<TemporalEntity>(params).pipe(
      map((entities) => {
        const summaries = new Map<string, CounterSummary>();
        for (const entity of entities) {
          const summary = summarizeCounter(entity.intensity?.values ?? []);
          if (summary) summaries.set(entity.id, summary);
        }
        return summaries;
      }),
    );
  }

  // ---- History for the statistics tab ------------------------------------
  // The server aggregates (sum, avg, min, max per hour or day), so each
  // request returns one bucket per sensor and period instead of every reading.
  // Measured on 2026-10-15: 0.4 s, 0.6 s and 1.9 s.

  /** Bikes counted per counter and UTC day, with the number of readings. */
  getCounterDays(days = 28): Observable<CounterDay[]> {
    return forkJoin({
      entities: this.getEntities('counter'),
      series: this.getAggregated('counter', 'intensity', 'sum,totalCount', 'P1D', days),
    }).pipe(
      map(({ entities, series }) => {
        const names = new Map(entities.map((e) => [e.id, siteName(e)]));
        return series.flatMap((s) => {
          const sums = s['intensity']?.['sum'] ?? [];
          const counts = new Map(
            (s['intensity']?.['totalCount'] ?? []).map(([n, start]) => [start, n]),
          );
          return sums.map(([count, start]) => ({
            counterId: s.id,
            name: names.get(s.id) ?? s.id,
            date: start.slice(0, 10),
            count,
            readings: counts.get(start) ?? 0,
          }));
        });
      }),
    );
  }

  /** Hourly average of free spots per car park. */
  getParkingSeries(days = 7): Observable<ParkingSeries[]> {
    return forkJoin({
      entities: this.getEntities('parking'),
      series: this.getAggregated('parking', 'availableSpotNumber', 'avg', 'PT1H', days),
    }).pipe(
      map(({ entities, series }) => {
        const byId = new Map(entities.map((e) => [e.id, e]));
        return series.map((s) => ({
          id: s.id,
          name: byId.has(s.id) ? siteName(byId.get(s.id)!) : s.id,
          capacity: byId.get(s.id)?.totalSpotNumber?.value ?? null,
          hours: (s['availableSpotNumber']?.['avg'] ?? []).map(([available, start]) => ({
            start: new Date(start),
            available,
          })),
        }));
      }),
    );
  }

  /** Min and max of available bikes per station and hour. */
  getStationSeries(days = 7): Observable<StationSeries[]> {
    return forkJoin({
      entities: this.getEntities('bike'),
      series: this.getAggregated('bike', 'availableBikeNumber', 'min,max', 'PT1H', days),
    }).pipe(
      map(({ entities, series }) => {
        const byId = new Map(entities.map((e) => [e.id, e]));
        return series.map((s) => {
          const attr = s['availableBikeNumber'];
          const maxByStart = new Map((attr?.['max'] ?? []).map(([v, start]) => [start, v]));
          return {
            id: s.id,
            name: byId.has(s.id) ? siteName(byId.get(s.id)!) : s.id,
            capacity: byId.get(s.id)?.totalSlotNumber?.value ?? null,
            hours: (attr?.['min'] ?? []).map(([min, start]) => ({
              start: new Date(start),
              min,
              max: maxByStart.get(start) ?? min,
            })),
          };
        });
      }),
    );
  }

  private getAggregated(
    kind: SiteKind,
    attr: string,
    methods: string,
    period: string,
    days: number,
  ): Observable<AggregatedEntity[]> {
    // Start at midnight UTC so daily buckets are whole UTC days.
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    since.setUTCDate(since.getUTCDate() - days);
    return this.getTemporal<AggregatedEntity>({
      type: NGSI_TYPES[kind],
      attrs: attr,
      timerel: 'after',
      timeAt: since.toISOString(),
      format: 'aggregatedValues',
      aggrMethods: methods,
      aggrPeriodDuration: period,
      limit: 1000,
    });
  }

  private getTemporal<T>(params: Record<string, string | number>): Observable<T[]> {
    return this.http
      .get<T[]>(`${BASE_URL}/temporal/entities`, { params, observe: 'response' })
      .pipe(
        map((res) => {
          // 206 = the server cut the answer at 10,000 points (api-findings.md,
          // section 3). Not expected at these sizes; warn rather than hide it.
          if (res.status === 206) console.warn('Temporal answer truncated (HTTP 206)', params);
          return res.body ?? [];
        }),
      );
  }
}

/** Sum of the readings in the 24 h up to the last one. Exported for tests. */
export function summarizeCounter(values: [number, string][]): CounterSummary | null {
  const last = values.at(-1);
  if (!last) return null;
  const observedAt = new Date(last[1]);
  const start = observedAt.getTime() - 24 * 3_600_000;
  // Strictly after start: 24 hourly readings, not 25.
  const dailyCount = values
    .filter(([, t]) => new Date(t).getTime() > start)
    .reduce((sum, [v]) => sum + v, 0);
  return { dailyCount, observedAt };
}

/** Converts one NGSI-LD entity into a Site. Exported for tests. */
export function toSite(kind: SiteKind, e: NgsiEntity, counter?: CounterSummary): Site {
  const [lon, lat] = e.location.value.coordinates;
  const live = kind === 'bike' ? e.availableBikeNumber : e.availableSpotNumber;
  const capacity = kind === 'bike' ? e.totalSlotNumber : e.totalSpotNumber;
  const observedAt = kind === 'counter' ? counter?.observedAt : live?.observedAt;
  return {
    id: e.id,
    kind,
    name: siteName(e),
    lat,
    lon,
    available: kind === 'counter' ? null : (live?.value ?? null),
    capacity: kind === 'counter' ? null : (capacity?.value ?? null),
    dailyCount: counter?.dailyCount ?? null,
    status: e.status?.value ?? null,
    observedAt: observedAt ? new Date(observedAt) : null,
  };
}

// Bike stations have no name, only an address object. 15 counters have an
// empty name: fall back to the end of the id (e.g. COM23120110).
function siteName(e: NgsiEntity): string {
  if (e.name?.value) return e.name.value;
  const address = e.address?.value;
  if (typeof address === 'object' && address.streetAddress) return address.streetAddress;
  return e.id.split(':').at(-1) ?? e.id;
}
