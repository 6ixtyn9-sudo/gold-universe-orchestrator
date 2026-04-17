from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from fetcher.parsers.results_clean import parse_results_clean
from fetcher.parsers.upcoming_clean import parse_upcoming_clean
from fetcher.satellite_bundle_fetcher import fetch_satellite_bundle


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _norm_team(s: str) -> str:
    s = (s or "").strip().lower()
    return re.sub(r"[^a-z0-9]+", "", s)


def _bundle_dir(cache_root: str, spreadsheet_id: str) -> Path:
    return Path(cache_root) / spreadsheet_id


def _first_existing(dirp: Path, names: List[str]) -> Optional[Path]:
    for n in names:
        p = dirp / n
        if p.exists():
            return p
    return None


def _load_values_json(path: Path) -> List[List[Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    return payload.get("values") or []


def _ft_winner_side(ft_h: Optional[int], ft_a: Optional[int]) -> Optional[str]:
    if ft_h is None or ft_a is None:
        return None
    if ft_h > ft_a:
        return "home"
    if ft_a > ft_h:
        return "away"
    return "draw"


def _pick_side(pred: str, home: str, away: str) -> Optional[str]:
    p = (pred or "").strip().lower()
    if not p:
        return None

    if p in {"1", "home", "h"}:
        return "home"
    if p in {"2", "away", "a"}:
        return "away"
    if p in {"x", "draw", "d"}:
        return "draw"

    # sometimes pred is a team name
    ph = _norm_team(p)
    if ph and ph == _norm_team(home):
        return "home"
    if ph and ph == _norm_team(away):
        return "away"

    return None


def _league_key(s: str) -> str:
    return (s or "").strip() or "Unknown"


@dataclass
class SmokeAssayReport:
    spreadsheet_id: str
    bundle_dir: str
    generated_at: str
    used_cache: bool
    counts: Dict[str, Any]
    leagues: List[Dict[str, Any]]
    samples: List[Dict[str, Any]]


def run_smoke_assay(
    spreadsheet_id: str,
    *,
    cache_root: str = "cache/satellites",
    use_cache: bool = True,
    include_patterns: bool = False,
    min_interval_s: float = 1.2,
    credentials: Optional[Any] = None,
    max_samples: int = 80,
) -> Dict[str, Any]:
    """Bundle-based smoke assay: grades UpcomingClean pred vs ResultsClean FT winner."""
    if not spreadsheet_id or not str(spreadsheet_id).strip():
        raise ValueError("spreadsheet_id is required")

    bdir = _bundle_dir(cache_root, spreadsheet_id)
    manifest = bdir / "manifest.json"

    used_cache = False
    if use_cache and manifest.exists():
        used_cache = True
    else:
        fetch_satellite_bundle(
            spreadsheet_id=spreadsheet_id,
            out_dir=str(bdir),
            include_patterns=include_patterns,
            min_interval_s=min_interval_s,
            credentials=credentials,
        )

    # bundle file candidates (logical keys become filenames via key.replace("::","__"))
    upcoming_file = _first_existing(
        bdir,
        [
            "core__UpcomingClean.json",
            "core__Upcoming_Clean.json",
            "core__Upcoming.json",
            "core__UpcomingRaw.json",
        ],
    )
    results_file = _first_existing(
        bdir,
        [
            "core__ResultsClean.json",
            "core__Results_Clean.json",
            "core__Results.json",
            "core__ResultsRaw.json",
        ],
    )

    if not upcoming_file:
        raise RuntimeError(f"Missing Upcoming core tab in bundle dir: {bdir}")
    if not results_file:
        raise RuntimeError(f"Missing Results core tab in bundle dir: {bdir}")

    upcoming_values = _load_values_json(upcoming_file)
    results_values = _load_values_json(results_file)

    upcoming = parse_upcoming_clean(upcoming_values)
    results = parse_results_clean(results_values)

    # Build results index: game_id -> result row
    result_by_id: Dict[str, Dict[str, Any]] = {}
    for r in results:
        gid = r.get("game_id")
        if gid:
            result_by_id[gid] = r

    graded: List[Dict[str, Any]] = []
    league_stats: Dict[str, Dict[str, Any]] = {}

    for u in upcoming:
        gid = u.get("game_id")
        if not gid:
            continue
        rr = result_by_id.get(gid)
        if not rr:
            continue

        ft_h = rr.get("ft_h")
        ft_a = rr.get("ft_a")
        actual = _ft_winner_side(ft_h, ft_a)
        pick = _pick_side(u.get("pred", ""), u.get("home", ""), u.get("away", ""))

        if actual is None or pick is None:
            continue

        hit = pick == actual
        league = _league_key(u.get("league") or rr.get("league"))

        rec = {
            "game_id": gid,
            "league": league,
            "date": u.get("date") or rr.get("date"),
            "time": u.get("time") or rr.get("time"),
            "home": u.get("home"),
            "away": u.get("away"),
            "pred_raw": u.get("pred"),
            "pick_side": pick,
            "actual_side": actual,
            "hit": bool(hit),
            "prob_pct": u.get("prob_pct", 0.0),
            "ft_h": ft_h,
            "ft_a": ft_a,
        }
        graded.append(rec)

        st = league_stats.setdefault(league, {"league": league, "graded": 0, "hits": 0})
        st["graded"] += 1
        st["hits"] += 1 if hit else 0

    leagues_out: List[Dict[str, Any]] = []
    for league, st in league_stats.items():
        graded_n = int(st["graded"])
        hits_n = int(st["hits"])
        hit_rate = (hits_n / graded_n) if graded_n else 0.0
        leagues_out.append(
            {
                "league": league,
                "graded": graded_n,
                "hits": hits_n,
                "hit_rate": hit_rate,
            }
        )

    leagues_out.sort(key=lambda x: (x["hit_rate"], x["graded"]), reverse=True)
    samples = sorted(graded, key=lambda x: (x.get("prob_pct", 0.0), x["date"] or ""), reverse=True)[:max_samples]

    counts = {
        "upcoming_parsed": len(upcoming),
        "results_parsed": len(results),
        "results_indexed": len(result_by_id),
        "graded": len(graded),
        "hits": sum(1 for r in graded if r["hit"]),
        "hit_rate": (sum(1 for r in graded if r["hit"]) / len(graded)) if graded else 0.0,
    }

    report = SmokeAssayReport(
        spreadsheet_id=spreadsheet_id,
        bundle_dir=str(bdir),
        generated_at=_utc_now_iso(),
        used_cache=used_cache,
        counts=counts,
        leagues=leagues_out,
        samples=samples,
    )
    return {
        "spreadsheet_id": report.spreadsheet_id,
        "bundle_dir": report.bundle_dir,
        "generated_at": report.generated_at,
        "used_cache": report.used_cache,
        "counts": report.counts,
        "leagues": report.leagues,
        "samples": report.samples,
        "source_files": {
            "upcoming": str(upcoming_file),
            "results": str(results_file),
        },
    }
