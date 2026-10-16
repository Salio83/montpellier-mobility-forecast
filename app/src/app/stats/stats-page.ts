import { DecimalPipe, PercentPipe } from '@angular/common';
import { Component, computed, inject, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ChartConfiguration } from 'chart.js';
import { catchError, map, Observable, of } from 'rxjs';
import { MobilityApiService } from '../services/mobility-api.service';
import { SitesStore } from '../services/sites-store';
import { ChartView } from './chart';
import {
  busiestParkings,
  currentFigures,
  dailyIndex,
  emptyFullShares,
  hourlyOccupancyProfile,
  reliableParkings,
  topCounters,
  weekdayIndexes,
  WEEKDAYS,
} from './stats';

// Categorical slots 1 and 2 of the reference palette (validated together:
// CVD and normal-vision separation pass on the light surface).
const SERIES_1 = '#2a78d6';
const SERIES_2 = '#eb6834';
const GRID = '#e6e6e3';
const AXIS_TEXT = '#59636e';

export const COUNTER_DAYS = 28;
export const HISTORY_DAYS = 7;

/** State of one section: loading, failed, or loaded with its data. */
type Load<T> = { status: 'loading' } | { status: 'error' } | { status: 'ok'; data: T };

function load<T>(source: Observable<T>): Signal<Load<T>> {
  return toSignal(
    source.pipe(
      map((data): Load<T> => ({ status: 'ok', data })),
      catchError(() => of<Load<T>>({ status: 'error' })),
    ),
    { initialValue: { status: 'loading' } },
  );
}

@Component({
  selector: 'app-stats-page',
  imports: [ChartView, DecimalPipe, PercentPipe],
  templateUrl: './stats-page.html',
  styleUrl: './stats-page.css',
})
export class StatsPage {
  private readonly api = inject(MobilityApiService);
  private readonly store = inject(SitesStore);

  protected readonly counterDays = COUNTER_DAYS;
  protected readonly historyDays = HISTORY_DAYS;
  protected readonly weekdays = WEEKDAYS;
  protected readonly hours = Array.from({ length: 24 }, (_, h) => h);
  protected readonly colors = { weekday: SERIES_1, weekend: SERIES_2 };

  // The three history requests start when the tab opens, in parallel.
  protected readonly counters = load(this.api.getCounterDays(COUNTER_DAYS));
  protected readonly parkings = load(this.api.getParkingSeries(HISTORY_DAYS));
  protected readonly stations = load(this.api.getStationSeries(HISTORY_DAYS));

  // ---- Right now --------------------------------------------------------
  protected readonly now = computed(() => currentFigures(this.store.freshSites()));
  protected readonly loaded = computed(() => this.store.lastRefresh() !== null);

  // ---- Bike traffic -----------------------------------------------------
  protected readonly daily = computed(() => {
    const c = this.counters();
    return c.status === 'ok' ? dailyIndex(c.data) : [];
  });
  protected readonly byWeekday = computed(() => {
    const c = this.counters();
    return c.status === 'ok' ? weekdayIndexes(c.data) : [];
  });
  protected readonly topCounters = computed(() => {
    const c = this.counters();
    return c.status === 'ok' ? topCounters(c.data) : [];
  });
  // Indexes are shown x 100: 100 = the counters' typical day.
  protected readonly dailyChart = computed(() =>
    lineChart(
      this.daily().map((d) => d.date.slice(5)),
      [
        {
          label: 'Traffic index',
          data: this.daily().map((d) => toPercent(d.index)),
          color: SERIES_1,
        },
      ],
    ),
  );
  protected readonly weekdayChart = computed(() =>
    barChart(WEEKDAYS, 'Traffic index', this.byWeekday().map(toPercent)),
  );

  // ---- Car parks --------------------------------------------------------
  protected readonly reliable = computed(() => {
    const p = this.parkings();
    return p.status === 'ok' ? reliableParkings(p.data) : { kept: [], rejected: [] };
  });
  protected readonly profile = computed(() => {
    const p = this.parkings();
    return p.status === 'ok' ? hourlyOccupancyProfile(this.reliable().kept) : null;
  });
  protected readonly busiest = computed(() => busiestParkings(this.reliable().kept));
  protected readonly profileChart = computed(() => {
    const profile = this.profile();
    if (!profile) return null;
    return lineChart(
      this.hours.map((h) => `${h}h`),
      [
        { label: 'Weekdays', data: profile.weekday.map(toPercent), color: SERIES_1 },
        { label: 'Weekend', data: profile.weekend.map(toPercent), color: SERIES_2 },
      ],
      { max: 100, suffix: ' %' },
    );
  });

  // ---- Bike stations ----------------------------------------------------
  private readonly shares = computed(() => {
    const s = this.stations();
    return s.status === 'ok' ? emptyFullShares(s.data) : [];
  });
  protected readonly mostEmpty = computed(() =>
    this.shares()
      .filter((s) => s.empty > 0) // a 0 % station is not "often empty"
      .sort((a, b) => b.empty - a.empty)
      .slice(0, 10),
  );
  protected readonly mostFull = computed(() =>
    this.shares()
      .filter((s) => s.full > 0)
      .sort((a, b) => b.full - a.full)
      .slice(0, 10),
  );
  /** Share of all station-hours spent empty / full, every station together. */
  protected readonly overall = computed(() => {
    const shares = this.shares();
    const hours = shares.reduce((t, s) => t + s.hours, 0);
    if (!hours) return null;
    return {
      empty: shares.reduce((t, s) => t + s.empty * s.hours, 0) / hours,
      full: shares.reduce((t, s) => t + s.full * s.hours, 0) / hours,
    };
  });
}

// ---- Chart configurations (marks follow the dataviz rules: 2px lines,
// 24px max bars with 4px rounded ends, hairline grid, tooltip on hover) ----

function axes(options: { max?: number; suffix?: string } = {}): ChartConfiguration['options'] {
  return {
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      tooltip: {
        callbacks: {
          // Rounded values: an hourly average of 157.27 spots reads as 157.
          label: (ctx) =>
            `${ctx.dataset.label}: ${Math.round(ctx.parsed.y ?? 0).toLocaleString('en')}${options.suffix ?? ''}`,
        },
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: AXIS_TEXT } },
      y: {
        beginAtZero: true,
        max: options.max,
        grid: { color: GRID },
        border: { display: false },
        ticks: {
          color: AXIS_TEXT,
          callback: (value) => `${Number(value).toLocaleString('en')}${options.suffix ?? ''}`,
        },
      },
    },
  };
}

function lineChart(
  labels: string[],
  series: { label: string; data: (number | null)[]; color: string }[],
  options: { max?: number; suffix?: string } = {},
): ChartConfiguration {
  return {
    type: 'line',
    data: {
      labels,
      datasets: series.map((s) => ({
        label: s.label,
        data: s.data,
        borderColor: s.color,
        backgroundColor: s.color,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHoverBorderWidth: 2,
        pointHoverBorderColor: '#fff',
        tension: 0, // straight segments: no invented values between the points
      })),
    },
    options: axes(options),
  };
}

function toPercent(value: number | null): number | null {
  return value === null ? null : value * 100;
}

function barChart(labels: string[], label: string, data: (number | null)[]): ChartConfiguration {
  return {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label,
          data,
          backgroundColor: SERIES_1,
          maxBarThickness: 24,
          borderRadius: 4,
          borderSkipped: 'start', // square at the baseline, rounded at the tip
        },
      ],
    },
    options: axes(),
  };
}
