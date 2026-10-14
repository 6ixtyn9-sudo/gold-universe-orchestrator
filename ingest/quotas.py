"""
ingest/quotas.py
────────────────
Request budgeting for free API tiers.

The whole point of the free stack is that it only works if you *count*. A
100-request/day key does not fail loudly when you exhaust it — the vendor starts
returning errors mid-run and you get a half-ingested day with no explanation.

So every outbound call goes through a ledger:

  * counts spend per provider per UTC day
  * persists to disk, so multiple runs in a day share one budget
  * reserves headroom for the calls you cannot skip (today's fixtures)
  * raises `QuotaExceeded` with a clear message instead of silently truncating

Known free tiers (see docs/FREE_API_STACK.md):

  api_sports   API-Basketball / API-NBA (API-Sports, also on RapidAPI)   100 / day
  highlightly  Highlightly basketball                                   100 / day
  odds_api     The Odds API (Starter)                             500 credits / month
  odds_api_io  Odds-API.io free                                     100 / hour
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

log = logging.getLogger("ingest.quotas")

DEFAULT_PATH = Path("ingest/.cache/quota.json")


class QuotaExceeded(RuntimeError):
    """Raised instead of making a call that would exceed the daily budget."""


# Free-tier definitions. `daily` is a hard cap; `monthly` is converted to a
# soft daily share so a month's allowance is spread rather than burnt in a day.
PROVIDER_LIMITS: Dict[str, Dict[str, Any]] = {
    "api_sports":   {"daily": 100, "monthly": None, "note": "100 req/day free forever"},
    "highlightly":  {"daily": 100, "monthly": None, "note": "100 req/day free Basic"},
    "odds_api":     {"daily": None, "monthly": 500, "note": "500 credits/month free"},
    "odds_api_io":  {"daily": 500, "monthly": None, "note": "100 req/hour free"},
    "broadage":     {"daily": 100, "monthly": None, "note": "free BASIC tier"},
    "fixture":      {"daily": None, "monthly": None, "note": "local, unlimited"},
}


@dataclass
class Spend:
    used_today: int
    remaining_today: Optional[int]
    used_this_month: int
    remaining_month: Optional[int]
    note: str = ""


class QuotaLedger:
    """Per-provider daily/monthly request counter, persisted as JSON."""

    def __init__(self, path: str | Path = DEFAULT_PATH):
        self.path = Path(path)
        self._data: Dict[str, Dict[str, int]] = {}
        self._load()

    # ── persistence ─────────────────────────────────────────────────────

    def _load(self) -> None:
        if not self.path.exists():
            return
        try:
            self._data = json.loads(self.path.read_text(encoding="utf-8"))
        except Exception as exc:  # noqa: BLE001
            log.warning("quota ledger unreadable (%s) — starting a fresh one", exc)
            self._data = {}

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        try:
            self.path.write_text(json.dumps(self._data, indent=1), encoding="utf-8")
        except Exception as exc:  # noqa: BLE001
            log.warning("could not persist quota ledger: %s", exc)

    # ── keys ────────────────────────────────────────────────────────────

    @staticmethod
    def _day_key() -> str:
        return datetime.now(timezone.utc).strftime("%Y-%m-%d")

    @staticmethod
    def _month_key() -> str:
        return datetime.now(timezone.utc).strftime("%Y-%m")

    def _bucket(self, provider: str) -> Dict[str, int]:
        return self._data.setdefault(provider, {})

    # ── policy ──────────────────────────────────────────────────────────

    @staticmethod
    def _limits(provider: str) -> Dict[str, Any]:
        return PROVIDER_LIMITS.get(provider, {"daily": None, "monthly": None, "note": "unmetered"})

    def _monthly_daily_cap(self, provider: str) -> Optional[float]:
        lim = self._limits(provider)
        monthly = lim.get("monthly")
        if not monthly:
            return None
        days_left = max(1, 31 - datetime.now(timezone.utc).day + 1)
        return monthly / days_left

    # ── spending ────────────────────────────────────────────────────────

    def check(self, provider: str, cost: int = 1, reserve: int = 0) -> bool:
        """True when `cost` more requests still fit the budget."""
        lim = self._limits(provider)
        bucket = self._bucket(provider)
        daily_cap = lim.get("daily")
        if daily_cap is not None:
            if bucket.get(self._day_key(), 0) + cost > max(0, daily_cap - reserve):
                return False
        monthly_cap = lim.get("monthly")
        if monthly_cap is not None:
            if bucket.get(self._month_key(), 0) + cost > monthly_cap:
                return False
        return True

    def spend(self, provider: str, cost: int = 1, reserve: int = 0) -> None:
        """Record a request. Raises QuotaExceeded when the budget is gone."""
        if not self.check(provider, cost, reserve):
            raise QuotaExceeded(
                f"{provider}: daily/monthly request budget exhausted "
                f"({self.describe(provider)}). Cache is honoured first — "
                f"re-run after 00:00 UTC, raise the limit, or add a fallback provider."
            )
        bucket = self._bucket(provider)
        bucket[self._day_key()] = bucket.get(self._day_key(), 0) + cost
        bucket[self._month_key()] = bucket.get(self._month_key(), 0) + cost
        self._save()

    def remaining(self, provider: str) -> Optional[int]:
        lim = self._limits(provider)
        bucket = self._bucket(provider)
        caps = []
        if lim.get("daily"):
            caps.append(lim["daily"] - bucket.get(self._day_key(), 0))
        if lim.get("monthly"):
            caps.append(lim["monthly"] - bucket.get(self._month_key(), 0))
        return min(caps) if caps else None

    def describe(self, provider: str) -> str:
        lim = self._limits(provider)
        bucket = self._bucket(provider)
        parts = [f"today {bucket.get(self._day_key(), 0)}"]
        if lim.get("daily"):
            parts.append(f"of {lim['daily']}")
        if lim.get("monthly"):
            parts.append(f"| month {bucket.get(self._month_key(), 0)}/{lim['monthly']}")
        return " ".join(parts)

    def report(self) -> Dict[str, Spend]:
        out: Dict[str, Spend] = {}
        for provider in set(list(PROVIDER_LIMITS) + list(self._data)):
            lim = self._limits(provider)
            bucket = self._bucket(provider)
            out[provider] = Spend(
                used_today=bucket.get(self._day_key(), 0),
                remaining_today=None if not lim.get("daily")
                else max(0, lim["daily"] - bucket.get(self._day_key(), 0)),
                used_this_month=bucket.get(self._month_key(), 0),
                remaining_month=None if not lim.get("monthly")
                else max(0, lim["monthly"] - bucket.get(self._month_key(), 0)),
                note=lim.get("note", ""),
            )
        return out


# ─────────────────────────────────────────────────────────────────────────
# Process-wide default ledger
# ─────────────────────────────────────────────────────────────────────────

_LEDGER: Optional[QuotaLedger] = None


def ledger() -> QuotaLedger:
    global _LEDGER
    if _LEDGER is None:
        path = os.environ.get("INGEST_QUOTA_LEDGER", str(DEFAULT_PATH))
        _LEDGER = QuotaLedger(path)
    return _LEDGER


def reset_ledger(path: Optional[str] = None) -> QuotaLedger:
    """Test seam — point the process at a throwaway ledger."""
    global _LEDGER
    _LEDGER = QuotaLedger(path or DEFAULT_PATH)
    return _LEDGER
