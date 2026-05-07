"""
brain/config_ledger.py
──────────────────────
Port of Config_Ledger_Satellite.gs — Config snapshot stamping.
Now writes to Supabase `config_ledger_global` instead of per-sheet Config_Ledger tabs.
"""

from __future__ import annotations
import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from brain.utils import derive_stamp_id, to_num, to_bool

log = logging.getLogger("brain.config_ledger")


def build_config_snapshot(
    config_tier2: Dict[str, Any],
    acc_config: Dict[str, Any],
    contract_version: str = "GOLD-UNIVERSE-CONTRACT-1.0",
    active_leagues: list = None,
) -> Dict[str, Any]:
    """
    Port of ConfigLedger_Satellite._buildConfigSnapshot
    Builds a canonical config snapshot from available settings.
    """
    return {
        "version":        contract_version,
        "built_at":       datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "active_leagues": json.dumps(sorted(active_leagues or [])),
        "tier_strong_min": acc_config.get("strong_target"),
        "tier_medium_min": acc_config.get("medium_target"),
        "conf_min":        acc_config.get("even_target"),
        "conf_elite":      acc_config.get("strong_target"),
        "spread_buckets":  config_tier2.get("spread_buckets", "[]"),
        "line_buckets":    config_tier2.get("line_buckets", "[]"),
        "conf_buckets":    config_tier2.get("conf_buckets", "[]"),
        "strict_side":     to_bool(config_tier2.get("strict_side", True)),
        "outright_only":   to_bool(config_tier2.get("outright_only", True)),
        # Accumulator gating
        "banker_threshold":    acc_config.get("bankerThreshold"),
        "sniper_min_margin":   acc_config.get("sniperMinMargin"),
        "max_snipers_per_game": acc_config.get("maxSnipersPerGame"),
        "ou_min_conf":         acc_config.get("ouMinConf"),
        "ou_min_ev":           acc_config.get("ouMinEV"),
        "min_edge_score":      acc_config.get("minEdgeScore"),
        # Feature flags
        "include_ou":      acc_config.get("includeOUSignals"),
        "include_hq":      acc_config.get("includeHighestQuarter"),
        "enable_robbers":  acc_config.get("enableRobbers"),
        "enable_1h":       acc_config.get("enableFirstHalf"),
        "enable_ftou":     acc_config.get("enableFTOU"),
        "hq_min_conf":     acc_config.get("hqMinConfidence"),
    }


def get_stamp_id(config_snapshot: Dict[str, Any]) -> str:
    """Derive a deterministic stamp ID from config snapshot."""
    return derive_stamp_id(config_snapshot)


def upsert_config_to_supabase(
    sb,  # Supabase client
    config_snapshot: Dict[str, Any],
) -> str:
    """
    Write config snapshot to Supabase config_ledger_global table.
    Returns the stamp_id.
    """
    stamp_id = get_stamp_id(config_snapshot)

    row = {
        "stamp_id":        stamp_id,
        "version":         config_snapshot.get("version"),
        "built_at":        config_snapshot.get("built_at"),
        "active_leagues":  config_snapshot.get("active_leagues"),
        "tier_thresholds": json.dumps({
            "strong": config_snapshot.get("tier_strong_min"),
            "medium": config_snapshot.get("tier_medium_min"),
        }),
        "conf_thresholds": json.dumps({
            "min": config_snapshot.get("conf_min"),
            "elite": config_snapshot.get("conf_elite"),
        }),
        "settings_json": json.dumps({
            k: config_snapshot[k]
            for k in [
                "banker_threshold", "sniper_min_margin", "max_snipers_per_game",
                "ou_min_conf", "ou_min_ev", "min_edge_score",
                "include_ou", "include_hq", "enable_robbers",
                "enable_1h", "enable_ftou", "hq_min_conf",
                "strict_side", "outright_only",
            ]
            if k in config_snapshot
        }),
    }

    try:
        sb.table("config_ledger_global").upsert(row, on_conflict="stamp_id").execute()
        log.info(f"✅ Config ledger upserted: {stamp_id}")
    except Exception as e:
        log.warning(f"⚠️ Config ledger upsert failed: {e}")

    return stamp_id
