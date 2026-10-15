import { Component, effect, ElementRef, input, OnDestroy, output, viewChild } from '@angular/core';
import * as L from 'leaflet';
import { Site, SiteKind, volume } from '../models/site';

const MONTPELLIER: L.LatLngTuple = [43.6108, 3.8767];

// Marker radius in pixels. The biggest site of each type gets MAX_RADIUS.
const MIN_RADIUS = 4;
const MAX_RADIUS = 16;

// Read from the CSS variables in styles.css so the legend and the markers
// use the same colours.
const KIND_COLOR_VARS: Record<SiteKind, string> = {
  bike: '--color-bike',
  parking: '--color-parking',
  counter: '--color-counter',
};

@Component({
  selector: 'app-map',
  template: '<div #container class="map"></div>',
  styles: ':host, .map { display: block; height: 100%; }',
})
export class MapView implements OnDestroy {
  readonly sites = input.required<Site[]>();
  readonly selectedId = input<string | null>(null);
  readonly siteClick = output<Site>();

  private readonly container = viewChild.required<ElementRef<HTMLElement>>('container');
  private map?: L.Map;
  // Circle markers instead of L.marker: no icon image files to bundle, and
  // the colour shows the type at a glance.
  private readonly layer = L.layerGroup();

  constructor() {
    // Re-runs whenever sites() or selectedId() changes.
    effect(() => {
      const sites = this.sites();
      const selectedId = this.selectedId();
      this.ensureMap();
      this.drawMarkers(sites, selectedId);
    });
  }

  ngOnDestroy(): void {
    this.map?.remove();
  }

  private ensureMap(): void {
    if (this.map) return;
    this.map = L.map(this.container().nativeElement).setView(MONTPELLIER, 13);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(this.map);
    this.layer.addTo(this.map);
  }

  private drawMarkers(sites: Site[], selectedId: string | null): void {
    // Simple approach: clear and redraw (about 160 markers, every minute).
    this.layer.clearLayers();
    const styles = getComputedStyle(document.documentElement);
    const maxVolume = maxVolumeByKind(sites);
    // Draw big markers first so small ones stay clickable on top of them.
    const sorted = [...sites].sort((a, b) => (volume(b) ?? 0) - (volume(a) ?? 0));
    for (const site of sorted) {
      const selected = site.id === selectedId;
      L.circleMarker([site.lat, site.lon], {
        radius: markerRadius(volume(site), maxVolume[site.kind]),
        weight: selected ? 3 : 1,
        color: selected ? '#000' : '#fff',
        fillColor: styles.getPropertyValue(KIND_COLOR_VARS[site.kind]).trim(),
        fillOpacity: 0.8,
      })
        .bindTooltip(site.name)
        .on('click', () => this.siteClick.emit(site))
        .addTo(this.layer);
    }
  }
}

// One scale per type: a car park of 450 spots and a station of 27 slots are
// not comparable, and counters are measured in bikes per day.
function maxVolumeByKind(sites: Site[]): Record<SiteKind, number> {
  const max = { bike: 0, parking: 0, counter: 0 };
  for (const site of sites) max[site.kind] = Math.max(max[site.kind], volume(site) ?? 0);
  return max;
}

// Square root, so the marker AREA grows with the volume: with a linear
// radius, a site twice as big would look four times as big. MIN_RADIUS keeps
// small sites clickable, so the proportion is only approximate.
export function markerRadius(value: number | null, max: number): number {
  if (value === null || max <= 0) return MIN_RADIUS;
  return MIN_RADIUS + (MAX_RADIUS - MIN_RADIUS) * Math.sqrt(value / max);
}
