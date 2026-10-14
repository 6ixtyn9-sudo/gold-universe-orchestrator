"""
ingest/configs.py
─────────────────
Per-league tuning configs — the piece that must survive the move off sheets.

Today each satellite carries its own `Config_Tier1` / `Config_Tier2` tabs,
written by Config_Tuner.gs and read by Data_Parser.gs.  Without them the engine
falls back to the repo defaults in `load_tier1_config`, which are only
placeholders — a league that had 40 dates of tuning would silently regress to
vanilla weights.

So configs become first-class files:

    ingest/configs/united-states-nba.json
    {
      "source_satellite": "api:united-states-nba:2026-10-14",
      "Config_Tier1": [["key", "value"], ["pctWeight", 0.8], ...],
      "Config_Tier2": [["key", "value"], ["ou_min_conf", 58], ...]
    }

Export them from the snapshots the fleet already mirrored:

    python -m ingest.cli export-config --bundle ingest/out/api_united-states-nba_2026-10-14
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

from brain.data_parser import (
    load_accumulator_config,
    load_tier1_config,
    parse_config_tier2,
)

log = logging.getLogger("ingest.configs")

CONFIG_DIR = Path(__file__).with_name("configs")


def config_path(league_key: str) -> Path:
    return CONFIG_DIR / f"{league_key}.json"


def load_config(league_key: str) -> Dict[str, Any]:
    """
    Effective config for a league: repo defaults overlaid with the league's
    exported Config_Tier1/Tier2 values.
    """
    base: Dict[str, Any] = {"tier1": load_tier1_config({}), "tier2": load_accumulator_config({})}
    path = config_path(league_key)
    if not path.exists():
        return {"tier1": base["tier1"], "tier2": base["tier2"], "source": "defaults"}

    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        log.error("config for %s is unreadable (%s) — using defaults", league_key, exc)
        return {"tier1": base["tier1"], "tier2": base["tier2"], "source": "defaults"}

    tier1_kv = _kv_to_dict(doc.get("Config_Tier1"))
    tier2_kv = _kv_to_dict(doc.get("Config_Tier2"))

    return {
        "tier1": load_tier1_config(tier1_kv),
        "tier2": load_accumulator_config(tier2_kv),
        "source": str(path),
    }


def flatten(league_key: str) -> Dict[str, Any]:
    """One flat dict, camelCase tier-1 merged under the snake_case O/U keys."""
    cfg = load_config(league_key)
    merged: Dict[str, Any] = {}
    merged.update(cfg["tier2"])
    merged.update(cfg["tier1"])
    # keep the keys brain/signal_processor reads
    merged.setdefault("ou_min_conf", merged.get("ouMinConf", 55.0))
    return merged


def export_from_bundle(bundle_dir: str | Path, league_key: str, out_dir: Optional[Path] = None) -> Path:
    """
    Turn a satellite bundle (local sink output) into a league config file.

    Reads Config_Tier1 / Config_Tier2 exactly as the Assayer and the Brain do,
    so what we export is what the engine has been using.
    """
    bundle = Path(bundle_dir)
    out_dir = out_dir or CONFIG_DIR
    out_dir.mkdir(parents=True, exist_ok=True)

    doc: Dict[str, Any] = {"source_bundle": bundle.name}
    for tab, key in (("Config_Tier1", "Config_Tier1"), ("Config_Tier2", "Config_Tier2")):
        path = bundle / f"core__{tab}.json"
        if not path.exists():
            continue
        try:
            values = json.loads(path.read_text(encoding="utf-8")).get("values") or []
        except Exception as exc:  # noqa: BLE001
            log.warning("cannot read %s: %s", path, exc)
            continue
        doc[key] = values

    target = out_dir / f"{league_key}.json"
    target.write_text(json.dumps(doc, indent=1), encoding="utf-8")
    return target


def _kv_to_dict(values: Any) -> Dict[str, Any]:
    """Config tabs are key/value rows; accept the parsed form too."""
    if not values:
        return {}
    if isinstance(values, dict):
        return values
    if isinstance(values, list):
        return parse_config_tier2(values)
    return {}


def available_configs() -> List[str]:
    if not CONFIG_DIR.exists():
        return []
    return sorted(p.stem for p in CONFIG_DIR.glob("*.json"))
