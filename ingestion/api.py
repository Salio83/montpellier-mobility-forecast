"""HTTP client for the Montpellier NGSI-LD API.

API behaviour this code relies on is measured in docs/api-findings.md (section 3).
"""

import logging
import re
import time
from dataclasses import dataclass
from datetime import datetime, timezone

import requests

BASE_URL = "https://portail-api-data.montpellier.fr/ngsi-ld/v1"
TIMEOUT_S = 60
MAX_ATTEMPTS = 4
PAUSE_S = 0.5  # pause after each successful request, to stay polite with the API

log = logging.getLogger(__name__)


class ApiError(Exception):
    pass


@dataclass
class ApiResponse:
    """One HTTP response, with what is needed to store it as a raw file."""

    url: str
    params: dict
    status: int
    content_range: str | None
    collected_at: datetime
    body: object


def iso(t: datetime) -> str:
    return t.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def get(session: requests.Session, path: str, params: dict) -> ApiResponse:
    """GET with retries and exponential backoff on network errors, 429 and 5xx."""
    url = BASE_URL + path
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            r = session.get(url, params=params, headers={"Accept": "application/json"}, timeout=TIMEOUT_S)
        except requests.RequestException as e:
            error = str(e)
        else:
            if r.status_code != 429 and r.status_code < 500:
                r.raise_for_status()  # other 4xx: a bug in our request, retrying will not help
                time.sleep(PAUSE_S)
                return ApiResponse(
                    url=url,
                    params=params,
                    status=r.status_code,
                    content_range=r.headers.get("Content-Range"),
                    collected_at=datetime.now(timezone.utc),
                    body=r.json(),
                )
            error = f"HTTP {r.status_code}"
        if attempt == MAX_ATTEMPTS:
            raise ApiError(f"{url} {params}: {error} after {MAX_ATTEMPTS} attempts")
        wait = 2**attempt  # 2, 4, 8 s
        log.warning("%s (attempt %d/%d), retrying in %d s", error, attempt, MAX_ATTEMPTS, wait)
        time.sleep(wait)


def list_entities(session: requests.Session, entity_type: str) -> ApiResponse:
    # Every type has fewer than 1,000 entities: no pagination needed.
    return get(session, "/entities", {"type": entity_type, "limit": 1000})


# Content-Range of a 206 response: "date-time <first>-<last returned>/*".
_CONTENT_RANGE = re.compile(r"date-time\s+(\S+?Z)-(\S+?Z)/")


def parse_content_range_end(header: str | None) -> datetime | None:
    """Timestamp of the last point returned, from a Content-Range header."""
    m = _CONTENT_RANGE.search(header or "")
    return datetime.fromisoformat(m.group(2)) if m else None


def fetch_temporal(
    session: requests.Session, entity_id: str, attr: str, start: datetime, end: datetime
) -> list[ApiResponse]:
    """All values of `attr` in [start, end), following HTTP 206 pages.

    `attr` can list several attributes, comma-separated. A response holds at
    most 10,000 points per attribute. When the range has more, the server
    answers 206 and cuts the end: the next request restarts from the last
    timestamp returned. That point comes back twice; the loader ignores it.
    """
    pages = []
    t = start
    while True:
        params = {
            "attrs": attr,
            "timerel": "between",
            "timeAt": iso(t),
            "endTimeAt": iso(end),
            "format": "temporalValues",
        }
        resp = get(session, f"/temporal/entities/{entity_id}", params)
        pages.append(resp)
        if resp.status != 206:
            return pages
        last = parse_content_range_end(resp.content_range)
        if last is None or last <= t:
            raise ApiError(f"{entity_id}: HTTP 206 with unusable Content-Range {resp.content_range!r}")
        t = last
