import { computed, inject, Service, signal } from '@angular/core';
import { catchError, EMPTY, switchMap, tap, timer } from 'rxjs';
import { isFresh, Site } from '../models/site';
import { MobilityApiService } from './mobility-api.service';

// Bike stations update about every minute, car parks every 5 minutes
// (api-findings.md, section 4). Polling faster would bring nothing new.
const REFRESH_MS = 60_000;

// Live state shared by the map and the statistics tabs. As a root service it
// lives as long as the app, so switching tabs does not reload the data.
@Service()
export class SitesStore {
  private readonly api = inject(MobilityApiService);

  readonly sites = signal<Site[]>([]);
  readonly lastRefresh = signal<Date | null>(null);
  readonly error = signal<string | null>(null);

  // Sites without a recent live value are not shown at all (see D13).
  // Freshness is judged at the time of the last refresh.
  readonly freshSites = computed(() => {
    const now = this.lastRefresh() ?? new Date();
    return this.sites().filter((s) => isFresh(s, now));
  });
  readonly hiddenCount = computed(() => this.sites().length - this.freshSites().length);

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
              this.error.set(
                'The Montpellier API is not responding. Showing the last known values.',
              );
              return EMPTY;
            }),
          ),
        ),
      )
      .subscribe();
  }
}
