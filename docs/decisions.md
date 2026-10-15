# Decision log

Each entry records what was chosen, what was rejected, and why.
Status: **Accepted** (applied), **Proposed** (not confirmed yet), **Superseded** (replaced by a later entry).

---

## D1. Use only the NGSI-LD endpoints

- **Date:** 2026-10-13
- **Status:** Accepted

**Context.** The API offers two families of endpoints: the old ones and the new NGSI-LD ones (`/ngsi-ld/v1/...`). The old ones are deprecated and stop on 2026-12-31, before the project ends.

**Decision.** All ingestion code uses `/ngsi-ld/v1/entities` (current state) and `/ngsi-ld/v1/temporal/entities/{id}` (history).

**Rejected.** Old endpoints: they would work today but break in less than three months.

**Consequences.** Code must handle NGSI-LD specifics measured in step 0 (see `api-findings.md`): `format=temporalValues` for compact responses, the 10,000-point cap, and HTTP 206 partial responses that must be resumed from the `Content-Range` header.

---

## D2. One repository, folders by role

- **Date:** 2026-10-14
- **Status:** Accepted

**Context.** The project has several parts (collection, analysis, model, map) that share the same database and the same data.

**Decision.** A single repository (monorepo) organised by role:

```
ingestion/   API clients, collection scripts, loaders (Python)
analysis/    usage analysis, project A (Python, notebooks)
models/      features, training, evaluation, project B (Python)
app/         interactive map and dashboard (Angular)
docs/        roadmap, API findings, decisions
data/        local raw data, not committed
docker-compose.yml
```

The Angular project generated as `dashboard/` was renamed `app/` to match this layout and the roadmap. The empty `scripts/` folder was removed: its role belongs to `ingestion/`. Empty folders hold a `.gitkeep` file because Git does not track empty folders.

**Rejected.**
- One repository per part: more overhead (several READMEs, CI pipelines, versions to keep in sync) for a one-person project.
- Folders by language (`python/`, `web/`): says how the code is written, not what it does.

**Consequences.** A recruiter reads the whole project in one place. `docker compose up` can start every service from the root.

---

## D3. Raw data stays local and separate from cleaned data

- **Date:** 2026-10-13
- **Status:** Accepted

**Context.** API responses must be kept as received (with their collection timestamp) so cleaning can be redone if a rule changes. Raw files are large (one day of one bike station is about 1,400 points) and can be downloaded again.

**Decision.** Raw responses go to `data/raw/`, which is ignored by Git. Cleaned data will live in database tables (see the schema decision, still to come).

**Rejected.** Committing data: makes the repository heavy, and Git is not designed to version large data files.

**Consequences.** Another person who clones the repository must run the collection to get data. The README must explain how.

---

## D4. A single `.gitignore` at the root

- **Date:** 2026-10-14
- **Status:** Accepted

**Context.** `ng new` created its own `.gitignore` inside the Angular folder, next to the root one. Two files split the ignore rules, so it is harder to know why a file is ignored.

**Decision.** One `.gitignore` at the root, with sections (project, Python, Angular, editors, system). Angular rules are prefixed with `app/`.

Why the prefix: in a `.gitignore`, a pattern that contains a `/` (at the start or in the middle) is relative to the folder of the `.gitignore` file. Angular's `/dist` meant `app/dist` when the file was in `app/`; from the root it must be written `app/dist/`. For the same reason `.vscode/*` became `**/.vscode/*` so it applies in every folder. A pattern without a slash (like `node_modules/`) matches at any depth.

**Rejected.** Keeping both files: valid for Git, but the rules are scattered.

**Consequences.** `git check-ignore -v <path>` shows which line ignores a file. New ignore rules for the Angular app go in the root file, under the Angular section.

---

## D5. Commit `.env.example`, never `.env`

- **Date:** 2026-10-14
- **Status:** Accepted

**Context.** Configuration (database password, URLs) is passed through environment variables. The first `.gitignore` ignored both `.env` and `.env.example`.

**Decision.** `.env` is ignored, `.env.example` is committed (rule `!.env.example`). It lists every variable with a fake or default value.

**Rejected.** Ignoring both: someone who clones the project would not know which variables to set. Committing `.env`: secrets would end up in the Git history, where they stay even after deletion.

**Consequences.** Each new environment variable must be added to `.env.example`.

---

## D6. Angular for the map and dashboard

- **Date:** 2026-10-14
- **Status:** Accepted (replaces Streamlit, which was in the first proposed stack)

**Context.** The front-end shows the current state of stations, car parks and counters on a map, and the forecasts. Data is refreshed periodically (the exact API update rate is still to measure, likely minutes for car parks and about one minute for bike stations).

**Decision.** An Angular application in `app/`, with Leaflet for the map (confirmed in D12).

Reasons:
- Angular is studied in class this year, so the project practises it.
- Its reactive tools fit periodic updates: signals redraw only what depends on a changed value, and RxJS expresses polling simply (`interval` + `switchMap`, which cancels a request still in flight when a new one starts).
- A separate front-end and API give an architecture close to a real product, which matches a hybrid data + software profile.

**Rejected.** Streamlit: a single Python program, faster to build, and enough for a dashboard refreshed every few minutes. Rejected for the learning goal and the architecture, not because it could not do the job.

**Consequences.**
- The browser cannot query PostgreSQL directly, so a backend API is needed between the database and the front-end (see D7).
- One more service to build, test and run in Docker Compose.
- The speed of updates is not a strong argument on its own: with data that changes every few minutes, any tool would be enough.

---

## D7. A backend API between the database and Angular

- **Date:** 2026-10-14
- **Status:** Proposed

**Context.** Follows from D6: Angular needs an HTTP API to read the current state and the forecasts.

**Proposal.** FastAPI (Python), so the API shares language and code (models, features) with ingestion and modelling.

**Alternatives to compare before deciding.**
- Calling the Montpellier API directly from Angular: no forecasts (they come from our model), dependence on CORS settings we do not control, and no use of our own cleaned data.
- A Node.js backend: same language as the front-end, but the model code is in Python.

**Open questions.** Where the API code lives (new `api/` folder or inside `ingestion/`), and which endpoints it exposes.

---

## D8. PostgreSQL + PostGIS in Docker Compose

- **Date:** 2026-10-14
- **Status:** Accepted

**Context.** The project stores time series (one value per sensor and timestamp) and sensor locations shown on a map.

**Decision.** PostgreSQL 18 with the PostGIS 3.6 extension, image `postgis/postgis:18-3.6`, started by `docker compose up`.

- The image tag is pinned: `latest` could change version without warning and break the project.
- Credentials come from `.env` (see D5). The host port is configurable (`POSTGRES_PORT`, default 5433) because 5432 is often already used by another local PostgreSQL.
- Data lives in a named Docker volume (`db_data`), so it survives `docker compose down`. Only `docker compose down -v` deletes it.
- A healthcheck (`pg_isready`) tells other services when the database accepts connections.

**Rejected.**
- PostgreSQL without PostGIS: coordinates would be two plain number columns, and distance or area queries would be written by hand. Adding PostGIS later means a migration.
- TimescaleDB: designed for much larger time series. Another tool to explain, with no need at this volume (tens of millions of rows).

**Consequences.** Locations are stored as PostGIS `geometry` columns. The schema is the next decision.

---

## D9. Store every bike station reading

- **Date:** 2026-10-14
- **Status:** Accepted

**Context.** About 99.5 % of bike readings repeat the previous value (see `api-findings.md`, section 4). Storing all of them means about 75,000 rows per day, about 27 million per year.

**Decision.** Store every reading, as received.

**Rejected.**
- Changes only (about 360 rows per day): we could no longer tell "value unchanged" from "sensor silent", and building a regular series for the model would need extra work.
- Aggregates (for example every 5 minutes): the original data would be lost in the database.

**Consequences.** PostgreSQL handles this volume with a suitable index on (sensor, timestamp). If size becomes a problem, compression or aggregation can be added later, since the raw data is kept (D10).

---

## D10. Raw API responses as JSON files in `data/raw/`

- **Date:** 2026-10-14
- **Status:** Accepted

**Context.** Raw responses must be kept with their collection time so cleaning can be redone (D3).

**Decision.** One JSON file per entity and time window, stored in `data/raw/`, with the collection time in the file name or content.

**Rejected.** A `jsonb` table in PostgreSQL: everything in one place and queryable in SQL, but it roughly doubles the database size and makes backups and resets heavier.

**Consequences.** The loader reads these files to fill the tables, so the tables can be rebuilt from the files without calling the API again.

---

## D11. Incremental sync, run by a collector container

- **Date:** 2026-10-14
- **Status:** Accepted

**Context.** Step 0 showed that the API keeps history since January 2025. Missing a polling run therefore loses no data, as long as we ask for it later.

**Decision.**
- **Incremental sync:** for each sensor, ask the temporal endpoint for everything after the last stored timestamp. The same code loads the full history the first time and keeps it up to date afterwards.
- **Scheduling:** a `collector` service in Docker Compose runs the sync every N minutes.

**Rejected.**
- Polling current values every minute: any downtime creates a permanent gap.
- GitHub Actions: runs when the computer is off, but cannot write into a local database. It would need a hosted database and credentials to manage.
- System cron: lives outside the repository, so it is not reproducible.

**Consequences.** The collector only runs while the computer is on, but the next run catches up. Its correctness depends on the HTTP 206 handling and on deduplication (D1).

---

## D12. First front-end reads the Montpellier API directly

- **Date:** 2026-10-15
- **Status:** Accepted (temporary, until D7)

**Context.** The map is needed early, but the database schema and the backend API (D7) do not exist yet. The Montpellier API allows calls from a browser (`Access-Control-Allow-Origin: *`, checked on 2026-10-15).

**Decision.** The Angular app calls `/ngsi-ld/v1/entities` directly for the current state, every 60 seconds. All API access sits in one service (`MobilityApiService`), which converts NGSI-LD entities into one `Site` type. Leaflet draws the map (confirms D6), with circle markers coloured by type.

**Rejected.**
- Mock data: the interface would show nothing real.
- Waiting for the backend: no visible result for weeks.

**Consequences.**
- No forecasts and no history in the interface yet: the panel says so.
- Counter readings are not in the entity list, so the panel fetches the last one (`lastN=1`) when a counter is selected (replaced in D13).
- When FastAPI exists, only the service changes. Components only know `Site`.
- On an API error the map keeps the last known values and shows a message (roadmap step 4).

---

## D13. Map: hide stale sites, size markers by volume

- **Date:** 2026-10-15
- **Status:** Accepted

**Context.** The map showed every listed entity, including car parks without any data or months-old values. All markers had the same size, so a 1,200-spot car park looked like an 8-slot bike station.

**Decision.**
- **Hide** a site when its last live value is older than a limit per type: 1 h for bike stations and car parks, 48 h for counters. Sites that never published a value (18 car parks) are hidden too. The sidebar shows how many sites are hidden.
- **Size** the markers by volume: capacity for bike stations and car parks, bikes counted in the 24 h up to the last reading for counters. One scale per type, and the radius grows with the square root of the volume so the marker area follows the volume.
- Counter readings come from one multi-entity temporal request (72 h window = 48 h freshness limit + 24 h total), instead of one request per counter on click.

**Why these limits.** Measured on 2026-10-15 (`api-findings.md`): stations under 2 minutes old, car parks under 10 minutes, but counters 9 to 35 h old even when they work. A 1 h limit for counters would hide all of them.

**Rejected.**
- Size by current value (free spots, bikes): the map would change at every refresh and empty stations would vanish. The current value stays in the detail panel.
- One common scale for all types: spots, slots and bikes per day are not comparable.
- Latest hourly count for counters: zero at night for every counter.

**Consequences.** The map shows fewer sites (123 of 161 on 2026-10-15). If a counter feed is published later than 48 h, it disappears until it catches up.

---

## Open decisions (not taken yet)

- Database schema (tables, keys, indexes).
- Sync interval of the collector.
- Where the API code of D7 lives.
- First forecasting target for project B.
