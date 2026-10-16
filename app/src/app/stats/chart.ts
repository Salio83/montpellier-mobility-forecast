import { Component, effect, ElementRef, input, OnDestroy, viewChild } from '@angular/core';
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  ChartConfiguration,
  Filler,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
} from 'chart.js';

// Register only the pieces used (bar and line charts), so the bundle does not
// carry every chart type of the library.
Chart.register(
  BarController,
  BarElement,
  CategoryScale,
  Filler,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
);

// Thin Angular wrapper: Chart.js draws on a <canvas> it owns, so the chart is
// rebuilt when the configuration changes and destroyed with the component.
@Component({
  selector: 'app-chart',
  template: '<canvas #canvas role="img" [attr.aria-label]="label()"></canvas>',
  styles: ':host { display: block; position: relative; height: 260px; }',
})
export class ChartView implements OnDestroy {
  readonly config = input.required<ChartConfiguration>();
  // Text read by screen readers, since a canvas has no content of its own.
  readonly label = input.required<string>();

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private chart?: Chart;

  constructor() {
    effect(() => {
      const config = this.config();
      this.chart?.destroy();
      this.chart = new Chart(this.canvas().nativeElement, config);
    });
  }

  ngOnDestroy(): void {
    this.chart?.destroy();
  }
}
