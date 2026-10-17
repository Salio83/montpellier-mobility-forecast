"""Raw API responses saved as JSON files (decision D10).

One file per HTTP response, with the request and the collection time, so the
tables can be rebuilt from the files without calling the API again.
"""

import json
import os
from pathlib import Path

from ingestion.api import ApiResponse

# Default: data/raw/ at the repository root. RAW_DIR overrides it (tests, container).
RAW_DIR = Path(os.environ.get("RAW_DIR", Path(__file__).resolve().parents[1] / "data" / "raw"))


def short_id(entity_id: str) -> str:
    # 'urn:ngsi-ld:EcoCounter:COM23120110' -> 'COM23120110'
    return entity_id.rsplit(":", 1)[-1]


def save(resp: ApiResponse, *parts: str, raw_dir: Path = RAW_DIR) -> Path:
    """Write resp to raw_dir/<parts...>/<collection time>.json and return the path."""
    folder = raw_dir.joinpath(*parts)
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / (resp.collected_at.strftime("%Y%m%dT%H%M%S%fZ") + ".json")
    record = {
        "url": resp.url,
        "params": resp.params,
        "status": resp.status,
        "content_range": resp.content_range,
        "collected_at": resp.collected_at.isoformat(),
        "body": resp.body,
    }
    path.write_text(json.dumps(record, ensure_ascii=False))
    return path
