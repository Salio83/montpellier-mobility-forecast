"""Incremental sync of the car parks (decisions D11, D16).

Same flow as counters.py: for each car park, ask the API for everything after
the last stored reading. Only the 21 car parks with a space guidance system
have readings; the 18 others answer 404 on the temporal endpoint.

Run from the repository root: python -m ingestion.parkings
"""

import logging
import sys
from datetime import datetime, timedelta, timezone

import psycopg
import requests

from ingestion import api, raw
from ingestion.counters import windows
from ingestion.db import connect

ENTITY_TYPE = "OffStreetParking"
# Both attributes come in one request and share their timestamps (checked on
# P-001 over 61 days, api-findings.md).
ATTRS = ("availableSpotNumber", "status")
HISTORY_START = datetime(2025, 1, 1, tzinfo=timezone.utc)  # the API keeps history since January 2025
# 30 days at one point every 5 min = 8,640 points, under the 10,000 cap. Longer
# ranges are split by HTTP 206 anyway, but very long ones time out (HTTP 504).
WINDOW = timedelta(days=30)
# Car parks are published within minutes: one hour back is enough to catch
# points that arrived late.
LOOKBACK = timedelta(hours=1)

log = logging.getLogger(__name__)


def has_sensor(entity: dict) -> bool:
    """True for car parks that publish readings (owner: the others have no guidance system)."""
    return "availableSpotNumber" in entity


def parking_row(entity: dict) -> dict:
    """One row of the parking table, from one NGSI-LD entity."""

    def value(attr):
        return entity.get(attr, {}).get("value")

    lon, lat = entity["location"]["value"]["coordinates"]
    height = value("maximumAllowedHeight")
    return {
        "id": entity["id"],
        "name": value("name"),
        "address": value("address"),
        "total_spots": value("totalSpotNumber"),
        "is_free": value("isFree"),
        "parking_type": value("parkingType"),
        "typology": value("typology"),
        "level_number": value("levelNumber"),
        # The API gives centimetres, or the string "N/A" for 8 car parks.
        "max_height_cm": height if isinstance(height, int) else None,
        "lon": lon,
        "lat": lat,
    }


def reading_rows(body: dict) -> list[tuple[str, datetime, int | None, str | None]]:
    """(parking_id, observed_at, available_spots, status) rows from a temporalValues response.

    The two attributes are joined on their timestamp. If one is missing at a
    timestamp, its column is None instead of dropping the other value.
    """
    spots = {t: v for v, t in body.get("availableSpotNumber", {}).get("values", [])}
    status = {t: v for v, t in body.get("status", {}).get("values", [])}
    return [
        (body["id"], datetime.fromisoformat(t), spots.get(t), status.get(t))
        for t in sorted(spots.keys() | status.keys())
    ]


def upsert_parkings(conn: psycopg.Connection, rows: list[dict]) -> None:
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO parking (id, name, address, total_spots, is_free, parking_type,
                                 typology, level_number, max_height_cm, geom)
            VALUES (%(id)s, %(name)s, %(address)s, %(total_spots)s, %(is_free)s, %(parking_type)s,
                    %(typology)s, %(level_number)s, %(max_height_cm)s,
                    ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326))
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name, address = EXCLUDED.address,
                total_spots = EXCLUDED.total_spots, is_free = EXCLUDED.is_free,
                parking_type = EXCLUDED.parking_type, typology = EXCLUDED.typology,
                level_number = EXCLUDED.level_number, max_height_cm = EXCLUDED.max_height_cm,
                geom = EXCLUDED.geom, loaded_at = now()
            """,
            rows,
        )


def insert_readings(conn: psycopg.Connection, rows: list[tuple]) -> int:
    """Insert readings, skip those already stored. Returns the number of new rows."""
    if not rows:
        return 0
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO parking_reading (parking_id, observed_at, available_spots, status)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (parking_id, observed_at) DO NOTHING
            """,
            rows,
        )
        return cur.rowcount


def last_observed(conn: psycopg.Connection) -> dict[str, datetime]:
    with conn.cursor() as cur:
        cur.execute("SELECT parking_id, max(observed_at) FROM parking_reading GROUP BY parking_id")
        return dict(cur.fetchall())


def sync(conn: psycopg.Connection, session: requests.Session, until: datetime) -> int:
    """Sync all car parks up to `until`. Returns the number of car parks that failed."""
    resp = api.list_entities(session, ENTITY_TYPE)
    raw.save(resp, "entities", ENTITY_TYPE)
    # All car parks go in the description table, even those without readings.
    upsert_parkings(conn, [parking_row(e) for e in resp.body])
    conn.commit()
    sensors = [e for e in resp.body if has_sensor(e)]
    log.info("%d car parks in the entity list, %d with readings", len(resp.body), len(sensors))

    last = last_observed(conn)
    failed = 0
    for entity in sensors:
        pid = entity["id"]
        start = max(HISTORY_START, last[pid] - LOOKBACK) if pid in last else HISTORY_START
        try:
            new = 0
            for a, b in windows(start, until, WINDOW):
                for page in api.fetch_temporal(session, pid, ",".join(ATTRS), a, b):
                    raw.save(page, "temporal", ENTITY_TYPE, raw.short_id(pid))
                    new += insert_readings(conn, reading_rows(page.body))
                conn.commit()  # one transaction per window: a failure keeps the windows already done
            log.info("%s: %d new readings since %s", raw.short_id(pid), new, api.iso(start))
        except (api.ApiError, requests.RequestException) as e:
            conn.rollback()
            failed += 1
            log.error("%s: %s", raw.short_id(pid), e)
    return failed


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    with connect() as conn, requests.Session() as session:
        failed = sync(conn, session, until=datetime.now(timezone.utc))
    if failed:
        log.error("%d car parks failed", failed)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
