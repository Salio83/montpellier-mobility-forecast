import { Routes } from '@angular/router';

// Pages are loaded on demand: the Chart.js code of the statistics tab is not
// downloaded until the tab is opened.
export const routes: Routes = [
  { path: '', loadComponent: () => import('./map/map-page').then((m) => m.MapPage) },
  {
    path: 'stats',
    title: 'Statistics · Montpellier mobility',
    loadComponent: () => import('./stats/stats-page').then((m) => m.StatsPage),
  },
  { path: '**', redirectTo: '' },
];
