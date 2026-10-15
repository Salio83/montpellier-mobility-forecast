import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, EMPTY, switchMap, tap, timer } from 'rxjs';
import { DetailPanel } from './detail-panel/detail-panel';
import { MapView } from './map/map';
import { isFresh, KIND_LABELS, Site, SiteKind } from './models/site';
import { MobilityApiService } from './services/mobility-api.service';

// Bike stations update about every minute, car parks every 5 minutes
// (api-findings.md, section 4). Polling faster would bring nothing new.
const REFRESH_MS = 60_000;

@Component({
  selector: 'app-root',
  imports: [DatePipe, DetailPanel, MapView],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private readonly api = inject(MobilityApiService);

  protected readonly kinds = Object.keys(KIND_LABELS) as SiteKind[];
  protected readonly kindLabels = KIND_LABELS;

  protected readonly sites = signal<Site[]>([]);
  protected readonly lastRefresh = signal<Date | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly visibleKinds = signal(new Set<SiteKind>(this.kinds));
  // Store the id, not the Site: after each refresh the selected site is
  // looked up again, so the panel shows the new values.
  protected readonly selectedId = signal<string | null>(null);

  // Sites without a recent live value are not shown at all (see D13).
  // Freshness is judged at the time of the last refresh.
  protected readonly freshSites = computed(() => {
    const now = this.lastRefresh() ?? new Date();
    return this.sites().filter((s) => isFresh(s, now));
  });
  protected readonly visibleSites = computed(() =>
    this.freshSites().filter((s) => this.visibleKinds().has(s.kind)),
  );
  protected readonly selected = computed(
    () => this.freshSites().find((s) => s.id === this.selectedId()) ?? null,
  );
  protected readonly counts = computed(() => {
    const counts = { bike: 0, parking: 0, counter: 0 };
    for (const s of this.freshSites()) counts[s.kind]++;
    return counts;
  });
  protected readonly hiddenCount = computed(
    () => this.sites().length - this.freshSites().length,
  );

  constructor() {
    // switchMap cancels a request still in flight when the next tick starts.
    // On error, keep the last known values and show a message instead of
    // emptying the map; the next tick retries.
    timer(0, REFRESH_MS)
      .pipe(
        switchMap(() =>
          this.api.getSites().pipe(
            tap((sites) => {
              this.sites.set(sites);
              this.lastRefresh.set(new Date());
              this.error.set(null);
            }),
            catchError(() => {
              this.error.set('The Montpellier API is not responding. Showing the last known values.');
              return EMPTY;
            }),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe();
  }

  protected toggleKind(kind: SiteKind): void {
    this.visibleKinds.update((current) => {
      const next = new Set(current);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }
}
