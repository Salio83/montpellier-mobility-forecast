import { Component, computed, inject, signal } from '@angular/core';
import { DetailPanel } from '../detail-panel/detail-panel';
import { KIND_LABELS, SiteKind } from '../models/site';
import { SitesStore } from '../services/sites-store';
import { MapView } from './map';

@Component({
  selector: 'app-map-page',
  imports: [DetailPanel, MapView],
  templateUrl: './map-page.html',
  styleUrl: './map-page.css',
})
export class MapPage {
  protected readonly store = inject(SitesStore);

  protected readonly kinds = Object.keys(KIND_LABELS) as SiteKind[];
  protected readonly kindLabels = KIND_LABELS;

  protected readonly visibleKinds = signal(new Set<SiteKind>(this.kinds));
  // Store the id, not the Site: after each refresh the selected site is
  // looked up again, so the panel shows the new values.
  protected readonly selectedId = signal<string | null>(null);

  protected readonly visibleSites = computed(() =>
    this.store.freshSites().filter((s) => this.visibleKinds().has(s.kind)),
  );
  protected readonly selected = computed(
    () => this.store.freshSites().find((s) => s.id === this.selectedId()) ?? null,
  );
  protected readonly counts = computed(() => {
    const counts = { bike: 0, parking: 0, counter: 0 };
    for (const s of this.store.freshSites()) counts[s.kind]++;
    return counts;
  });

  protected toggleKind(kind: SiteKind): void {
    this.visibleKinds.update((current) => {
      const next = new Set(current);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }
}
