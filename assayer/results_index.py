from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Tuple

@dataclass
class ResultIndex:
    by_game_id: Dict[str, Dict[str, Any]]
    duplicates: Dict[str, List[Dict[str, Any]]]

def build_result_index(results: List[Dict[str, Any]]) -> ResultIndex:
    """
    Build a deterministic mapping from game_id -> result row.
    If duplicate game_id occurs, keep the first occurrence and store all rows in duplicates[game_id].
    """
    by: Dict[str, Dict[str, Any]] = {}
    dups: Dict[str, List[Dict[str, Any]]] = {}

    for r in results:
        gid = (r.get("game_id") or "").strip()
        if not gid:
            continue
        if gid in by:
            dups.setdefault(gid, [by[gid]]).append(r)
            continue
        by[gid] = r

    return ResultIndex(by_game_id=by, duplicates=dups)

def summarize_index(idx: ResultIndex) -> Dict[str, Any]:
    return {
        "games_indexed": len(idx.by_game_id),
        "duplicate_game_ids": len(idx.duplicates),
        "duplicate_total_rows": sum(len(v) for v in idx.duplicates.values()),
    }
