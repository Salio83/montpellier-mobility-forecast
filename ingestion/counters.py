"""Incremental sync of the bike counters (decision D11).

For each counter, ask the API for everything after the last stored reading.
The first run loads the full history, the next ones only the new hours.

Run from the repository root: python -m ingestion.counters
"""

import logging
import sys
from datetime import datetime, timedelta, timezone

import psycopg
import requests

from ingestion import api, raw
from ingestion.db import connect

ENTITY_TYPE = "EcoCounter"
ATTR = "intensity"
HISTORY_START = datetime(2025, 1, 1, tzinfo=timezone.utc)  # the API keeps history since January 2025
WINDOW = timedelta(days=90)  # about 2,200 hourly points per request, far under the 10,000 cap
# Counters are published in batches, 9 to 35 h late. Re-reading the last days
# catches hours published late; points already stored are ignored.
LOOKBACK = timedelta(days=3)
# oldVersion references with a typo, confirmed by the data owner (api-findings.md).
OLD_VERSION_FIXES = {"urn:ngsi-ld:EcoCounter:Y2H20063163": "urn:ngsi-ld:EcoCounter:X2H20063163"}

log = logging.getLogger(__name__)


def counter_row(entity: dict) -> dict:
    """One row of the counter table, from one NGSI-LD entity."""

    def value(attr):
        return entity.get(attr, {}).get("value")

    lon, lat = entity["location"]["value"]["coordinates"]
    old = entity.get("oldVersion", {}).get("object")
    return {
        "id": entity["id"],
        "name": value("name"),
        "lane_id": value("laneId"),
        "reversed_lane": value("reversedLane"),
        "vehicle_type": value("vehicleType"),
        "old_version_id": OLD_VERSION_FIXES.get(old, old),
        "lon": lon,
        "lat": lat,
    }


def reading_rows(body: dict) -> list[tuple[str, datetime, int]]:
    """(counter_id, observed_at, intensity) rows from a temporalValues response.

    A counter without data in the range has no 'intensity' key at all.
    """
    values = body.get(ATTR, {}).get("values", [])
    return [(body["id"], datetime.fromisoformat(t), v) for v, t in values]


def windows(start: datetime, end: datetime, size: timedelta = WINDOW):
    """Consecutive [a, b) ranges covering [start, end)."""
    while start < end:
        yield start, min(start + size, end)
        start += size


def upsert_counters(conn: psycopg.Connection, rows: list[dict]) -> None:
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO counter (id, name, lane_id, reversed_lane, vehicle_type, geom)
            VALUES (%(id)s, %(name)s, %(lane_id)s, %(reversed_lane)s, %(vehicle_type)s,
                    ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326))
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name, lane_id = EXCLUDED.lane_id,
                reversed_lane = EXCLUDED.reversed_lane, vehicle_type = EXCLUDED.vehicle_type,
                geom = EXCLUDED.geom, loaded_at = now()
            """,
            rows,
        )
        # Second pass: the counter referenced by old_version_id must already exist.
        known = {r["id"] for r in rows}
        for r in rows:
            old = r["old_version_id"]
            if old and old not in known:
                log.warning("%s: oldVersion %s is not in the entity list, ignored", r["id"], old)
                old = None
            cur.execute("UPDATE counter SET old_version_id = %s WHERE id = %s", (old, r["id"]))


def insert_readings(conn: psycopg.Connection, rows: list[tuple]) -> int:
    """Insert readings, skip those already stored. Returns the number of new rows."""
    if not rows:
        return 0
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO counter_reading (counter_id, observed_at, intensity)
            VALUES (%s, %s, %s)
            ON CONFLICT (counter_id, observed_at) DO NOTHING
            """,
            rows,
        )
        return cur.rowcount


def last_observed(conn: psycopg.Connection) -> dict[str, datetime]:
    with conn.cursor() as cur:
        cur.execute("SELECT counter_id, max(observed_at) FROM counter_reading GROUP BY counter_id")
        return dict(cur.fetchall())


def sync(conn: psycopg.Connection, session: requests.Session, until: datetime) -> int:
    """Sync all counters up to `until`. Returns the number of counters that failed."""
    resp = api.list_entities(session, ENTITY_TYPE)
    raw.save(resp, "entities", ENTITY_TYPE)
    upsert_counters(conn, [counter_row(e) for e in resp.body])
    conn.commit()
    log.info("%d counters in the entity list", len(resp.body))

    last = last_observed(conn)
    failed = 0
    for entity in resp.body:
        cid = entity["id"]
        start = max(HISTORY_START, last[cid] - LOOKBACK) if cid in last else HISTORY_START
        try:
            new = 0
            for a, b in windows(start, until):
                for page in api.fetch_temporal(session, cid, ATTR, a, b):
                    raw.save(page, "temporal", ENTITY_TYPE, raw.short_id(cid))
                    new += insert_readings(conn, reading_rows(page.body))
                conn.commit()  # one transaction per window: a failure keeps the windows already done
            log.info("%s: %d new readings since %s", raw.short_id(cid), new, api.iso(start))
        except (api.ApiError, requests.RequestException) as e:
            conn.rollback()
            failed += 1
            log.error("%s: %s", raw.short_id(cid), e)
    return failed


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    with connect() as conn, requests.Session() as session:
        failed = sync(conn, session, until=datetime.now(timezone.utc))
    if failed:
        log.error("%d counters failed", failed)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
