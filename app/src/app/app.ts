import { DatePipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { SitesStore } from './services/sites-store';

// Shell: top bar with the tabs, then the page of the current route.
@Component({
  selector: 'app-root',
  imports: [DatePipe, RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly store = inject(SitesStore);
}
