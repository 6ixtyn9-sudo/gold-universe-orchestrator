import os
import json
import uuid
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

REGISTRY_PATH = os.path.join(os.path.dirname(__file__), "registry.json")

_EMPTY = {"satellites": []}


def _load():
    if not os.path.exists(REGISTRY_PATH):
        return dict(_EMPTY)
    try:
        with open(REGISTRY_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        logger.warning(f"Failed to load registry: {e}")
        return dict(_EMPTY)


def _save(data):
    try:
        with open(REGISTRY_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, default=str)
    except Exception as e:
        logger.error(f"Failed to save registry: {e}")


def list_satellites(date=None, league=None, fmt=None):
    data = _load()
    rows = data.get("satellites", [])
    if date:
        rows = [r for r in rows if r.get("date", "") == date]
    if league:
        rows = [r for r in rows if r.get("league", "").lower() == league.lower()]
    if fmt:
        rows = [r for r in rows if r.get("format", "") == fmt]
    return rows


def get_satellite(sat_id):
    data = _load()
    for s in data.get("satellites", []):
        if s.get("id") == sat_id:
            return s
    return None


def add_satellite(sheet_id, sheet_name="", date="", league="", notes=""):
    data = _load()
    sats = data.get("satellites", [])

    existing = [s for s in sats if s.get("sheet_id") == sheet_id]
    if existing:
        return existing[0], False

    sat = {
        "id": str(uuid.uuid4()),
        "sheet_id": sheet_id,
        "sheet_name": sheet_name or sheet_id,
        "date": date,
        "league": league,
        "notes": notes,
        "format": "unknown",
        "added_at": datetime.utcnow().isoformat(),
        "last_fetched": None,
        "last_assayed": None,
        "assay_summary": None,
    }
    sats.append(sat)
    data["satellites"] = sats
    _save(data)
    logger.info(f"Added satellite: {sheet_name or sheet_id}")
    return sat, True


def bulk_add(entries):
    results = []
    for entry in entries:
        sheet_id = entry.get("sheet_id", "").strip()
        if not sheet_id:
            results.append({"error": "missing sheet_id", "entry": entry})
            continue
        sat, created = add_satellite(
            sheet_id=sheet_id,
            sheet_name=entry.get("sheet_name", ""),
            date=entry.get("date", ""),
            league=entry.get("league", ""),
            notes=entry.get("notes", ""),
        )
        results.append({"satellite": sat, "created": created})
    return results


def remove_satellite(sat_id):
    data = _load()
    sats = data.get("satellites", [])
    before = len(sats)
    sats = [s for s in sats if s.get("id") != sat_id]
    if len(sats) == before:
        return False
    data["satellites"] = sats
    _save(data)
    return True


def update_satellite(sat_id, updates):
    data = _load()
    sats = data.get("satellites", [])
    for s in sats:
        if s.get("id") == sat_id:
            s.update(updates)
            break
    data["satellites"] = sats
    _save(data)


def summary_stats():
    sats = list_satellites()
    total = len(sats)
    fetched = sum(1 for s in sats if s.get("last_fetched"))
    assayed = sum(1 for s in sats if s.get("last_assayed"))

    bankers_total = 0
    robbers_total = 0
    gold_pct_sum = 0.0
    gold_pct_count = 0

    for s in sats:
        summary = s.get("assay_summary")
        if summary:
            bankers_total += summary.get("banker_count", 0)
            robbers_total += summary.get("robber_count", 0)
            gp = summary.get("gold_pct")
            if gp is not None:
                gold_pct_sum += gp
                gold_pct_count += 1

    avg_gold_pct = (gold_pct_sum / gold_pct_count) if gold_pct_count > 0 else None

    leagues = {}
    for s in sats:
        lg = s.get("league", "Unknown")
        if lg not in leagues:
            leagues[lg] = 0
        leagues[lg] += 1

    return {
        "total": total,
        "fetched": fetched,
        "assayed": assayed,
        "bankers_total": bankers_total,
        "robbers_total": robbers_total,
        "avg_gold_pct": avg_gold_pct,
        "league_counts": leagues,
    }
