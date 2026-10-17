"""Tests of the parsing functions (no network, no database)."""

from datetime import datetime, timedelta, timezone

from ingestion.api import parse_content_range_end
from ingestion.counters import counter_row, reading_rows, windows

UTC = timezone.utc

COUNTER = {
    "id": "urn:ngsi-ld:EcoCounter:ZLT26063736",
    "type": ["EcoCounter", "TrafficFlowObserved"],
    "name": {"type": "Property", "value": "Compteur Vélo Test"},
    "location": {"type": "GeoProperty", "value": {"type": "Point", "coordinates": [3.86, 43.58]}},
    "laneId": {"type": "Property", "value": 37618918},
    "vehicleType": {"type": "Property", "value": "bicycle"},
    "reversedLane": {"type": "Property", "value": False},
    "oldVersion": {"type": "Relationship", "object": "urn:ngsi-ld:EcoCounter:Y2H20063163"},
}


def test_counter_row_reads_attributes_and_fixes_known_typo():
    row = counter_row(COUNTER)
    assert row["name"] == "Compteur Vélo Test"
    assert (row["lon"], row["lat"]) == (3.86, 43.58)
    assert row["reversed_lane"] is False
    assert row["old_version_id"] == "urn:ngsi-ld:EcoCounter:X2H20063163"


def test_counter_row_without_name_or_old_version():
    entity = {k: v for k, v in COUNTER.items() if k not in ("name", "oldVersion")}
    row = counter_row(entity)
    assert row["name"] is None
    assert row["old_version_id"] is None


def test_reading_rows():
    body = {
        "id": "urn:ngsi-ld:EcoCounter:COM23120117",
        "intensity": {"type": "Property", "values": [[0, "2026-10-01T00:00:00Z"], [7, "2026-10-01T01:00:00Z"]]},
    }
    assert reading_rows(body) == [
        ("urn:ngsi-ld:EcoCounter:COM23120117", datetime(2026, 10, 1, 0, tzinfo=UTC), 0),
        ("urn:ngsi-ld:EcoCounter:COM23120117", datetime(2026, 10, 1, 1, tzinfo=UTC), 7),
    ]


def test_reading_rows_counter_without_data():
    # Measured: a counter without data answers 200 with no 'intensity' key.
    assert reading_rows({"id": "urn:ngsi-ld:EcoCounter:X2H20042632", "type": "EcoCounter"}) == []


def test_parse_content_range_end():
    header = "date-time 2026-08-01T00:00:00Z-2026-08-07T23:33:37Z/*"
    assert parse_content_range_end(header) == datetime(2026, 8, 7, 23, 33, 37, tzinfo=UTC)
    assert parse_content_range_end(None) is None


def test_windows_cover_range_without_overlap():
    start, end = datetime(2025, 1, 1, tzinfo=UTC), datetime(2025, 7, 1, tzinfo=UTC)
    ws = list(windows(start, end, timedelta(days=90)))
    assert ws[0][0] == start and ws[-1][1] == end
    assert all(a_next == b for (_, b), (a_next, _) in zip(ws, ws[1:]))


def test_windows_empty_when_start_is_after_end():
    t = datetime(2026, 1, 1, tzinfo=UTC)
    assert list(windows(t, t)) == []
