# API findings (step 0)

Exploration of the Montpellier Méditerranée Métropole open data API, run on 2026-10-13.

Legend:

- **[measured]**: observed in a real API response during the exploration
- **[spec]**: stated by the OpenAPI file (`fiware3m.yaml`) but not verified
- **[owner]**: confirmed by the data owner (two email replies from opendata@montpellier.fr on 2026-10-14: 09:33 about eco-counter units and timestamps, 14:35 about vehicle types, parkings without data and a typo)
- **[open]**: not known yet

Base URL: `https://portail-api-data.montpellier.fr`. Raw outputs are kept in `data/raw/exploration/` (not committed).

## 1. Access

- [measured] No authentication. `Accept: application/json` is enough, no JSON-LD `Link` header needed.
- [spec] Rate limits: 10,000 requests/second and 2,000,000 requests/hour. Not tested.
- [spec] The old (non NGSI-LD) endpoints stay available until 2026-12-31. Only `/ngsi-ld/v1/...` is used here.

## 2. Entity lists

`GET /ngsi-ld/v1/entities?type=<Type>&limit=1000`

| Type | Entities | Notes |
|---|---|---|
| BikeHireDockingStation | 52 | all `working`, all updated within the same minute |
| OffStreetParking | 39 | only 21 have `availableSpotNumber` |
| EcoCounter | 70 | no readings in the list, all `vehicleType = bicycle` |

- [measured] All counts are below the 1,000 limit, so lists need no pagination.
- [measured] ID formats: `urn:ngsi-ld:station:006`, `urn:ngsi-ld:OffStreetParking:34172-P-001`, `urn:ngsi-ld:EcoCounter:COM23120110`.
- [measured] Lists contain inactive entities (see section 5): a listed entity is not necessarily a working sensor.

## 3. Temporal endpoint behaviour

`GET /ngsi-ld/v1/temporal/entities/{entityId}`

- [measured] Without `format`, the response is a list of full instances (`value`, `unitCode`, `instanceId`, `observedAt`), although the spec says the default is `temporalValues`.
- [measured] `format=temporalValues` returns the same number of points (1,432 for one day of station 006) in 37 KiB instead of 218 KiB. Shape: `{"id": ..., "type": ..., "<attribute>": {"type": "Property", "values": [[value, "timestamp"], ...]}}`.
- [measured] A response holds at most 10,000 points (station 006, `temporalValues`, one attribute). The 1,000 limit of the spec does not apply to temporal queries. Up to 6 days (8,592 points) the answer is HTTP 200. With 7 days the server answered HTTP 206 (Partial Content) with exactly 10,000 points, from the start of the range up to 2026-08-07T23:33:37Z, while the range asked ended on 2026-08-08.
- [measured] An HTTP 206 is not an error, but its body is incomplete: the end of the range is cut. The header `Content-Range: date-time <start>-<last timestamp returned>/*` gives the covered range, so the next request can restart from that last timestamp. Code that treats every 2xx as complete would silently store truncated data.
- [measured] The `Link` header of the response points to the JSON-LD context. It is not a pagination link.
- [measured] Following 206 responses works: 14 days of station 006 (2026-08-01 to 2026-08-15) came back in 3 pages (10,000 + 10,000 + 50 points). The 20,048 distinct points collected equal the sum of the server's own daily `totalCount` (20,048).
- [measured] The boundary is inclusive: each new page starts with the last point of the previous page (9,999 new points out of 10,000, then 49 out of 50). Duplicates must be ignored.
- [measured] Parking P-001 (5-min data): 1, 7, 14 and 31 days all returned HTTP 200 (0.5 s, 1.5 s, 1.9 s, 4.1 s; 221 KiB for 31 days). At 288 points/day, 10,000 points correspond to about 34 days (estimate).
- [spec] Timestamps are UTC. Observed timestamps end with `Z`.
- [spec] Defaults are `timerel=after` and `timeAt=2025-12-31T23:59:59Z`. Always pass explicit `timeAt` / `endTimeAt`.
- [measured] `lastN=3` returned 3 points, oldest first.
- [measured] `format=aggregatedValues&aggrMethods=totalCount&aggrPeriodDuration=P1D` returns `totalCount: [[count, start, end], ...]`. Days without data are omitted, not returned as 0.
- [measured] Long ranges time out. A 650-day aggregated query returned HTTP 504 for station 006 (1-min data) and for parking P-001 (5-min data). It succeeded for parking P-007 (99,212 points, 26.8 s) and for an eco-counter (10,673 points, 1.7 s). Response time seems to grow with the number of points. The exact gateway limit is [open].
- [measured] The temporal endpoint returns HTTP 404 for the 18 parkings that have no `availableSpotNumber` in the list.
- [owner] These 18 parkings have no space guidance system ("système de jalonnement"), so they produce no occupancy data. This is expected, not a fault.

- [measured] Several entities at once: `/ngsi-ld/v1/temporal/entities?type=EcoCounter&attrs=intensity&timerel=after&timeAt=<t>&format=temporalValues` returns the readings of every counter in one request (53 counters with data over 3 days, 2,131 points, 0.3 s, 2026-10-15). Without `timerel` and `timeAt` the server answers HTTP 400 (`'timerel' and 'time' must be used in conjunction`), even with `lastN`.

- [measured] Server-side aggregation works on several entities at once (2026-10-15): `format=aggregatedValues` with `aggrMethods` (`sum`, `avg`, `min`, `max`, `totalCount`, several at once separated by commas) and `aggrPeriodDuration` (`PT1H`, `P1D`). Timings: daily `sum,totalCount` of all counters over 28 days 0.4 s; hourly `avg` of the 19 live car parks over 7 days 0.6 s; hourly `avg` of the 52 bike stations over 7 days 7.5 s (HTTP 200, 177 complete buckets per station), but hourly `min,max` of the same 1.9 s. Buckets start at `timeAt`, so `timeAt` at midnight UTC gives whole UTC days.

## 4. Sampling and coverage (samples only, not all entities)

| Source | Sampling | Observed coverage | Earliest data seen |
|---|---|---|---|
| Bike station 006 | ~1 min | 1,429 to 1,433 of 1,440 points/day (about 99.2 to 99.5 %), 7 days in Oct 2026 | 2025-01-05 (earliest day tested) |
| Parking P-001 | ~5 min (median) | 239, 0, 286 and 182 points on the 4 days tested (288 expected); one 135-min gap on 2026-10-12 | 2025-01-05 (earliest day tested) |
| Parking P-007 | ~5 min (~280 points/day) | 354 of 365 days with data in 2025 | 2025-01-01 (start of range queried) |
| Eco-counter COM23120110 | hourly | 469 of 482 days with data between first and last | 2025-06-16 |

- [spec] History starts 2025-01-04 (bikes, parkings) and 2025-01-12 (eco-counters). Start dates vary per sensor: COM23120110 starts later.
- [open] Why P-001 has 0 points on 2025-06-15.

Two full days (Sunday 2026-10-11 and Monday 2026-10-12, UTC), one request per entity and day, on all 52 bike stations and on the 21 parkings that have `availableSpotNumber`:

| Source | Day | Points | Per entity | Value changes |
|---|---|---|---|---|
| Bike stations (52) | Sun 2026-10-11 | 74,516 | 1,433 for every station | 359 (0.5 % of points) |
| Bike stations (52) | Mon 2026-10-12 | 74,464 | 1,432 for every station | 306 (0.4 % of points) |
| Parkings (21) | Sun 2026-10-11 | 3,727 | median 184, min 0, max 288 | 1,341 (36.0 %) |
| Parkings (21) | Mon 2026-10-12 | 3,571 | median 174, min 0, max 288 | 1,585 (44.4 %) |

- A "value change" is a reading that differs from the previous reading of the same entity within the day.
- [measured] Every bike station has exactly the same number of points on a given day. [hypothesis] The readings are taken for all stations at the same moments, so a missing minute would be missing for all stations. Not checked on timestamps.
- [measured] Only 0.4 to 0.5 % of the bike readings differ from the previous one. Two days only (a Sunday and a Monday in October): the rate may differ in other seasons.
- [measured] The two stale parkings (P-005, P-007) have 0 points on both days, which is included in the medians above. The 19 other parkings have between 173 and 288 points per day (288 = one point every 5 minutes), so their coverage varies.
- [measured] 36 to 44 % of the parking readings differ from the previous one.

Eco-counters, daily scan of `intensity` from 2025-01-01 to 2026-10-12 (UTC), one aggregated request per counter:

- [measured] 67 of 70 counters have data (none for X2H20042632, X2H20063161, XAH23111501). About 700,000 hourly points in total.
- [measured] 49 counters have data on 2026-10-12, 4 stopped on 2026-10-10 and 14 stopped between 2025-06-22 and 2026-09-17. The day-level scan hides intraday stops (the last point of X2H20063162 is 2026-10-12T00:00Z).
- [measured] 42 counters have their first data on 2025-01-01, the first day of the range queried, so their real history may start earlier (the spec says 2025-01-12). The other 25 start later: 2025-01-14, 2025-03-10, 2025-06-12, 2025-06-16, 2025-09-23, 2025-10-31, 2025-11-01, 2025-12-17, 2026-06-05 and 2026-07-05 (new counters).
- [measured] Counters with a long history have data on 607 to 632 of 650 days (XTH24072390: 559), with about 23 of 24 hourly points on days with data. Some are intermittent, for example X2H21070342 (196 of 325 days), X2H20063163 (202 of 325), COM23070049 (39 of 105) and COM24010119 (208 of 263).
- [measured] 15 counters have an empty or missing `name`. 10 of the 17 inactive counters (stopped for months, or without data) are among them, against 5 of the 53 others.
- [measured] 5 counters have an `oldVersion` attribute, a `Relationship` to the counter they replace: ZLT26043541 → X2H21070351, ZLT26063734 → X2H21111120, ZLT26063735 → X2H21070342, ZLT26063736 → Y2H20063163, ZLT26063738 → X2H22104772. The old counters found in the list are all nameless and stopped between 2025-06-22 and 2025-11-21, while the new ones start on 2026-07-05: a gap of about 7 to 12 months between an old counter and its replacement.
- [measured] `Y2H20063163` is not in the entity list, `X2H20063163` is (nameless, last data 2025-11-21). [owner] The reference is a typo for `X2H20063163`.
- [open] 10 nameless counters have no `oldVersion` link: X2H20042632, X2H20063161 and XAH23111501 (no data), X2H20063164 and COM23120111 (stopped), X2H20042633, X2H20042634, X2H20042635, X2H20063162 and ZLT26063737 (still sending).
- Raw result: `data/raw/exploration/eco_counters_coverage.json`.

## 5. Freshness census (2026-10-13, about 14:00 UTC)

Last reading per entity (`lastN=1`). The 24 h threshold is crude for hourly counters.

| Type | Fresh (< 24 h) | Older | No data / not found |
|---|---|---|---|
| BikeHireDockingStation | 52 | 0 | 0 |
| OffStreetParking | 19 | 2 | 18 (HTTP 404) |
| EcoCounter | 48 | 19 | 3 |

- Parkings: P-005 last reading 2026-09-28, P-007 last reading 2025-12-31. The 18 HTTP 404 are exactly the 18 parkings without `availableSpotNumber` in the list.
- Eco-counters, older: 14 silent for at least 25 days (oldest last reading 2025-06-22) and 5 late by 1.6 to 3 days.
- Eco-counters, no data since 2025-01-01: X2H20042632, X2H20063161, XAH23111501.
- [hypothesis] COM23120110, COM23120112, COM23120113 and COM23120114 share the same last reading (2026-10-10T13:00Z), which suggests a common cause (feed, gateway or site). It is not the whole family: COM23120117 and COM24010120 (same first day, 2025-06-16) are still sending data, and COM23120111 stopped in January 2026.
- [open] Whether late counters are stopped or only published late.

Raw result: `data/raw/exploration/last_readings.json`.

Publication delay, 2026-10-15 at 08:31 UTC (one snapshot):

- [measured] Bike stations: every reading under 2 minutes old.
- [measured] Car parks: the 19 live ones under 10 minutes old; P-005 408 h, P-007 6,905 h.
- [measured] Eco-counters: the most recent reading of any counter was 9 h old. 52 of the 53 counters with data in the last 3 days were 9 to 35 h old, one was 53 h old. Counters seem to be published in batches, not hour by hour. [open] The publication schedule.

## 6. Data quality notes

- Parkings, static attributes: `maximumAllowedHeight` is a number or the string `"N/A"`; `domaniality` is written `Public`, `public` or `Privé`; `insee` is a number (the spec says string); `parkingType`, `nb_velo`, `nb_2_rm` and `nb_voitures_electriques` are not in the spec.
- Parking `status` values seen: `Open`, `Full`.
- Bike station 006: `availableBikeNumber` + `freeSlotNumber` = `totalSlotNumber` (2 + 25 = 27). `totalSlotNumber` has no timestamp (static). Checked on one station only.
- Eco-counters: one entity per lane (`laneId`, `reversedLane`). `oldVersion` (5 counters) links a counter to the one it replaces (see section 4). `unitCode` is `H10`. In UN/CEFACT Recommendation 20 (the unit code list NGSI-LD uses), `H10` means "reciprocal hour" (1/h): `intensity` is a count per hour, consistent with the hourly sampling. Source: UNECE Rec. 20 code list. The data owner did not recognise the code itself, but [owner] confirmed that `intensity` is a count per hour.
- All 70 eco-counters have `vehicleType = bicycle`. Two names mention pedestrians (`Compteur Piéton/vélo Pavelet`, `Compteur Piéton/Vélo Berracasa`) and one mentions scooters (`Compteur Vélo et Trottinette Cours Gambetta`). Their entities have the same attributes as the others: no field tells what is counted.
- [owner] These counters can tell several user types apart, but the open data only publishes **bicycle** counts. `intensity` counts bikes only, at every counter. **No pedestrian or scooter data is available** in the open data.

More quality notes (2026-10-15):

- [measured] Car park P-019 (Charles de Gaulle, `parkingType` `enclos_en_surface`) lists `totalSpotNumber` 50, but its hourly average of `availableSpotNumber` ranged from 20 to 109 over 7 days (134 of 171 hours above 50). The listed capacity is wrong, or the free spot count covers something else. [open] Which one.
- [measured] Eco-counter completeness varies a lot from day to day. Over 2026-09-17..10-13, the number of counters with all 24 hourly readings on a UTC day ranged from 14 (2026-09-26) to 51 (2026-10-02, 2026-10-06). Many counter-days have 20 to 23 readings.
- [measured] Unusual days, measured with the per-counter index (D14): 2026-09-30 (Wednesday) at 20 % of the typical day, 2026-10-03 (Saturday) at 30 %. [open] Cause (weather is a hypothesis, not checked).

### Eco-counter timestamps are shifted for some counters

[owner] A database migration in April 2026 mixed up time zones. The family of a counter is the prefix of its ID (`COM`, `ZLT`, `X2H`).

- Data since April 2026 is stored in UTC: `COM` and `ZLT` counters are at the right time, `X2H` counters are shifted by the UTC–Paris difference.
- Data before April 2026 was stored in Paris time: `COM` and `ZLT` were shifted, `X2H` were at the right time.
- A patch has since corrected the data before April 2026. According to the owner, only `X2H` counters are still shifted today.
- Field check suggested by the owner: on weekdays except Wednesday, the morning peak is between 08:00 and 09:00 Paris time (07Z in winter, 06Z in summer). A peak one hour later means a remaining one-hour shift.

[measured] Check on 2026-10-16: hour of the weekday (Mon, Tue, Thu, Fri) morning peak, in UTC, average over about 3 weeks per period.

| Counter | 2026-02-02..02-28 (winter, before April) | 2025-09-15..10-10 (summer, before April) | 2026-09-07..10-02 (summer, after April) |
|---|---|---|---|
| X2H20042633 | 08Z | 07Z | 09Z |
| X2H20042634 | 08Z | 07Z | 09Z |
| COM23120117 | 07Z | 07Z | 06Z |
| COM24010120 | flat profile, no clear peak | flat profile | flat profile |
| ZLT26063737 | no data | no data | 06Z |

- After April 2026, the two `X2H` counters peak 2 h later than in summer 2025 (09Z instead of 07Z), and 2 h later than the Paris rule (06Z). This matches the owner: recent `X2H` timestamps are Paris time labelled as UTC.
- After April 2026, `COM23120117` and `ZLT26063737` peak at 06Z (08:00 Paris): correct, as the owner says.
- Contradiction: in summer 2025, `COM23120117` peaks at 07Z (09:00 Paris), one hour later than the rule and than its own peak in September 2026. [hypothesis] The patch for data before April removed a fixed 1 h instead of following daylight saving time, so summer data before April would still be 1 h late. Not proven: one reliable `COM` counter only.
- Unclear: by the owner's rule, `X2H` counters before April look 1 h late in winter (08Z instead of 07Z), while the owner says they are correct. These two sites may simply have a later peak (09:00 Paris), which would also explain 07Z in summer 2025.
- Limits: 4 counters with usable data, about 3 weeks per period, and the method assumes that a site keeps the same peak hour from one year to the next.
- [open] The exact date of the April 2026 switch, the shift of every counter month by month, and the hours around daylight saving changes (Paris time labelled as UTC has a missing hour in March and a doubled hour in October).

## 7. Implications (not decisions yet)

- Store timestamps as UTC (`timestamptz`) and convert to Paris time only for display.
- Always use explicit time ranges. Check the HTTP status of every temporal response: on 206, resume from the end of `Content-Range` instead of treating the data as complete.
- Ingestion must ignore duplicate points (same entity, attribute and timestamp): two pages always overlap on one point at their boundary.
- Bike readings are about 99.5 % repeats of the previous value, parking readings are not (36 to 44 % change). The storage strategy for bikes (all readings, changes only, or aggregates) is still to decide.
- Derive "active sensor" from the last reading, not from the entity list.
- Usable parking targets for project B: the 19 live parkings. P-005 and P-007 have partial history.
- Eco-counters have different lifetimes, so the analysis must handle start and stop dates per counter.
- A counter and the one replacing it (`oldVersion`) are different entities with a gap of 7 to 12 months. Their series must not be merged without documenting the gap.
- Eco-counter timestamps cannot be trusted as UTC for every counter and period (section 6). Hour-of-day analysis and any "hour" feature for the model need a per-family, per-period correction, checked on the data. Daily totals are less affected because night traffic is low, but `X2H` days after April 2026 are cut 2 h off (summer) when grouped by UTC day.
- Eco-counters are small (about 700,000 hourly points in total). A full history of 650 days (about 15,000 points) exceeds the 10,000-point cap, so raw requests need windows of a few months, or the 206 resume logic.

## 8. Still to verify

- Real history start for bikes, parkings and the 42 counters whose first data is on 2025-01-01 (the first day queried).
- Whether the 10,000-point cap counts points per attribute or in total, and whether it applies to `/temporal/entities` (several entities).
- Whether the 206 resume logic also matches the server count for parkings and eco-counters (validated on one bike station only).
- Whether bike stations really share the same timestamps (same point count per day suggests it).
- Why parking coverage varies between 173 and 288 points per day (different sampling rates, or gaps).
- Why 10 counters have no name.
- Eco-counter time shift for all counters, month by month (morning peak hour), to date the April 2026 switch and confirm or reject the 1 h shift of `COM` counters in summer 2025.
- Whether stopped counters come back (re-run the freshness census in a few days and compare).
- Coverage and sampling for all 161 entities, not only the samples above.