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

**Decision.** An Angular application in `app/`, with Leaflet for the map (to confirm when building the map).

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

## Open decisions (not taken yet)

- Database: PostgreSQL + PostGIS in Docker Compose is proposed, to confirm along with the schema.
- Storage strategy for bike readings: about 99.5 % of readings repeat the previous value (see `api-findings.md`, section 4). Options: store all readings, store changes only, or store aggregates.
- Collection scheduling: cron in a container or GitHub Actions.
- First forecasting target for project B.
