import { DatePipe } from '@angular/common';
import { Component, computed, input, output } from '@angular/core';
import { KIND_LABELS, Site } from '../models/site';

@Component({
  selector: 'app-detail-panel',
  imports: [DatePipe],
  templateUrl: './detail-panel.html',
  styleUrl: './detail-panel.css',
})
export class DetailPanel {
  readonly site = input.required<Site>();
  readonly closed = output<void>();

  protected readonly kindLabels = KIND_LABELS;

  /** Share of free spots or available bikes, for the gauge. */
  protected readonly ratio = computed(() => {
    const { available, capacity } = this.site();
    return available !== null && capacity ? Math.min(available / capacity, 1) : null;
  });

  /** "12 min ago", so the delay of the data is visible at once. */
  protected age(date: Date): string {
    const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
  }
}
