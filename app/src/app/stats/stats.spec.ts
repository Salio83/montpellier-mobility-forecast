import { Site } from '../models/site';
import {
  busiestParkings,
  CounterDay,
  currentFigures,
  counterBaselines,
  dailyIndex,
  emptyFullShares,
  hourlyOccupancyProfile,
  occupancy,
  parisHour,
  reliableParkings,
  topCounters,
  weekdayIndexes,
  weekdayOf,
} from './stats';

function day(counterId: string, date: string, count: number, readings = 24): CounterDay {
  return { counterId, name: counterId, date, count, readings };
}

describe('time helpers', () => {
  it('converts to Paris hours across the daylight-saving change', () => {
    expect(parisHour(new Date('2026-10-15T06:00:00Z'))).toBe(8); // summer, UTC+2
    expect(parisHour(new Date('2026-11-15T06:00:00Z'))).toBe(7); // winter, UTC+1
  });

  it('numbers weekdays from Monday', () => {
    expect(weekdayOf('2026-10-12')).toBe(0); // Monday
    expect(weekdayOf('2026-10-11')).toBe(6); // Sunday
  });
});

describe('counter statistics', () => {
  // Counter A is big (typical day 1,000), B is small (typical day 100).
  // 7 complete days each, so both get a baseline.
  const dates = [
    '2026-10-05',
    '2026-10-06',
    '2026-10-07',
    '2026-10-08',
    '2026-10-09',
    '2026-10-10',
    '2026-10-11',
  ];
  const base = [...dates.map((d) => day('A', d, 1000)), ...dates.map((d) => day('B', d, 100))];

  it('takes the median complete day as the typical day of a counter', () => {
    const baselines = counterBaselines([...base, day('A', '2026-10-12', 9999, 3)]);
    expect(baselines.get('A')).toBe(1000); // the 3-reading day is ignored
    expect(baselines.get('B')).toBe(100);
  });

  it('gives no typical day to a counter with too few complete days', () => {
    expect(counterBaselines([day('C', '2026-10-05', 500)]).has('C')).toBe(false);
  });

  it('is not fooled by a missing big counter', () => {
    // Ten counters like B, all at their typical level on both dates, plus A
    // only on the first date. A mean in bikes would drop; the index stays 1.
    const small = ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'];
    const history = [
      ...dates.map((d) => day('A', d, 1000)),
      ...small.flatMap((id) => dates.map((d) => day(id, d, 100))),
    ];
    const result = dailyIndex([
      ...history,
      day('A', '2026-10-12', 1000),
      ...small.map((id) => day(id, '2026-10-12', 100)),
      ...small.map((id) => day(id, '2026-10-13', 100)), // A missing
    ]);
    expect(result.at(-2)).toEqual({ date: '2026-10-12', index: 1, counters: 11 });
    expect(result.at(-1)).toEqual({ date: '2026-10-13', index: 1, counters: 10 });
  });

  it('leaves a gap for dates with too few counters', () => {
    const small = ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'];
    const history = small.flatMap((id) => dates.map((d) => day(id, d, 100)));
    const result = dailyIndex([...history, day('B', '2026-10-13', 50)]); // 1 counter only
    expect(result.find((d) => d.date === '2026-10-12')).toEqual({
      date: '2026-10-12',
      index: null,
      counters: 0,
    });
    expect(result.at(-1)).toEqual({ date: '2026-10-13', index: null, counters: 1 });
  });

  it('computes an index per weekday', () => {
    const small = ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'];
    // Every counter: 100 on weekdays, 50 on Saturday 10-10 and Sunday 10-11.
    const history = small.flatMap((id) =>
      dates.map((d) => day(id, d, d === '2026-10-10' || d === '2026-10-11' ? 50 : 100)),
    );
    const indexes = weekdayIndexes(history);
    expect(indexes[0]).toBe(1); // Monday
    expect(indexes[5]).toBe(0.5); // Saturday
  });

  it('ranks counters in real bikes per complete day', () => {
    expect(topCounters(base).map((c) => [c.name, c.meanPerDay])).toEqual([
      ['A', 1000],
      ['B', 100],
    ]);
  });
});

describe('car park statistics', () => {
  it('computes occupancy', () => {
    expect(occupancy(25, 100)).toBe(0.75);
  });

  it('rejects a whole car park whose data exceeds its capacity', () => {
    const { kept, rejected } = reliableParkings([
      { id: 'A', name: 'A', capacity: 100, hours: [{ start: new Date(), available: 40 }] },
      {
        id: 'CdG',
        name: 'Charles de Gaulle',
        capacity: 50,
        hours: [
          { start: new Date(), available: 30 },
          { start: new Date(), available: 109 },
        ],
      },
      { id: 'C', name: 'C', capacity: null, hours: [] },
    ]);
    expect(kept.map((p) => p.name)).toEqual(['A']);
    expect(rejected).toEqual(['Charles de Gaulle', 'C']);
  });

  it('splits the hourly profile between weekdays and weekends (Paris time)', () => {
    const profile = hourlyOccupancyProfile([
      {
        id: 'P',
        name: 'P',
        capacity: 100,
        hours: [
          { start: new Date('2026-10-12T06:00:00Z'), available: 20 }, // Mon 8h
          { start: new Date('2026-10-11T06:00:00Z'), available: 90 }, // Sun 8h
        ],
      },
    ]);
    expect(profile.weekday[8]).toBeCloseTo(0.8);
    expect(profile.weekend[8]).toBeCloseTo(0.1);
    expect(profile.weekday[9]).toBeNull();
  });

  it('ranks car parks by mean occupancy', () => {
    const ranking = busiestParkings([
      { id: 'A', name: 'A', capacity: 100, hours: [{ start: new Date(), available: 50 }] },
      { id: 'B', name: 'B', capacity: 100, hours: [{ start: new Date(), available: 10 }] },
    ]);
    expect(ranking.map((p) => p.name)).toEqual(['B', 'A']);
  });
});

describe('emptyFullShares', () => {
  it('counts only hours empty or full for the whole hour', () => {
    const [s] = emptyFullShares([
      {
        id: 'S',
        name: 'S',
        capacity: 10,
        hours: [
          { start: new Date(), min: 0, max: 0 }, // empty all hour
          { start: new Date(), min: 0, max: 3 }, // empty for part of it: not counted
          { start: new Date(), min: 10, max: 10 }, // full all hour
          { start: new Date(), min: 4, max: 6 },
        ],
      },
    ]);
    expect(s.empty).toBe(0.25);
    expect(s.full).toBe(0.25);
  });
});

describe('currentFigures', () => {
  const site = (kind: Site['kind'], available: number | null, capacity: number): Site => ({
    id: `${kind}${available}`,
    kind,
    name: '',
    lat: 0,
    lon: 0,
    available,
    capacity,
    dailyCount: null,
    status: null,
    observedAt: new Date(),
  });

  it('sums bikes and spots, counts empty and full stations', () => {
    const figures = currentFigures([
      site('bike', 0, 10),
      site('bike', 12, 12),
      site('bike', 5, 20),
      site('parking', 100, 400),
    ]);
    expect(figures.bikesAvailable).toBe(17);
    expect(figures.bikeSlots).toBe(42);
    expect(figures.stationsEmpty).toBe(1);
    expect(figures.stationsFull).toBe(1);
    expect(figures.freeSpots).toBe(100);
    expect(figures.parkingSpots).toBe(400);
  });
});
