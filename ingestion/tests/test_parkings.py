"""Tests of the car park parsing functions (no network, no database)."""

from datetime import datetime, timezone

from ingestion.parkings import has_sensor, parking_row, reading_rows

UTC = timezone.utc

# Trimmed copy of a real entity (P-001, entity list of 2026-10-17).
PARKING = {
    "id": "urn:ngsi-ld:OffStreetParking:34172-P-001",
    "type": "OffStreetParking",
    "name": {"type": "Property", "value": "Arc de Triomphe"},
    "address": {"type": "Property", "value": "rue Foch"},
    "isFree": {"type": "Property", "value": False},
    "typology": {"type": "Property", "value": "Centre-ville"},
    "levelNumber": {"type": "Property", "value": 5},
    "parkingType": {"type": "Property", "value": "ouvrage"},
    "location": {"type": "GeoProperty", "value": {"type": "Point", "coordinates": [3.8732007, 43.611004]}},
    "totalSpotNumber": {"type": "Property", "value": 451},
    "availableSpotNumber": {"type": "Property", "value": 126, "observedAt": "2026-10-17T11:30:05.000Z"},
    "maximumAllowedHeight": {"type": "Property", "value": 190},
}


def test_parking_row_reads_attributes():
    row = parking_row(PARKING)
    assert row["name"] == "Arc de Triomphe"
    assert row["address"] == "rue Foch"
    assert row["total_spots"] == 451
    assert row["is_free"] is False
    assert row["max_height_cm"] == 190
    assert (row["lon"], row["lat"]) == (3.8732007, 43.611004)


def test_parking_row_height_not_available():
    entity = {**PARKING, "maximumAllowedHeight": {"type": "Property", "value": "N/A"}}
    assert parking_row(entity)["max_height_cm"] is None


def test_parking_row_without_type_or_typology():
    # Measured: one car park has neither attribute.
    entity = {k: v for k, v in PARKING.items() if k not in ("parkingType", "typology")}
    row = parking_row(entity)
    assert row["parking_type"] is None
    assert row["typology"] is None


def test_has_sensor():
    assert has_sensor(PARKING)
    assert not has_sensor({k: v for k, v in PARKING.items() if k != "availableSpotNumber"})


def test_reading_rows_joins_both_attributes():
    body = {
        "id": "urn:ngsi-ld:OffStreetParking:34172-P-001",
        "availableSpotNumber": {"values": [[149, "2026-10-15T01:30:07Z"], [0, "2026-10-15T04:25:05Z"]]},
        "status": {"values": [["Open", "2026-10-15T01:30:07Z"], ["Full", "2026-10-15T04:25:05Z"]]},
    }
    pid = body["id"]
    assert reading_rows(body) == [
        (pid, datetime(2026, 10, 15, 1, 30, 7, tzinfo=UTC), 149, "Open"),
        (pid, datetime(2026, 10, 15, 4, 25, 5, tzinfo=UTC), 0, "Full"),
    ]


def test_reading_rows_keeps_value_when_other_attribute_missing():
    body = {
        "id": "urn:ngsi-ld:OffStreetParking:34172-P-001",
        "availableSpotNumber": {"values": [[149, "2026-10-15T01:30:07Z"]]},
        "status": {"values": [["Open", "2026-10-15T01:35:07Z"]]},
    }
    rows = reading_rows(body)
    assert [(r[2], r[3]) for r in rows] == [(149, None), (None, "Open")]


def test_reading_rows_without_data():
    # Measured on P-007 (stale since 2025-12-31): HTTP 200 with no attribute keys.
    assert reading_rows({"id": "urn:ngsi-ld:OffStreetParking:34172-P-007"}) == []
