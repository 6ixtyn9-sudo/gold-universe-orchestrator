"""
ingest/teams.py
───────────────
Team-name reconciliation between an API feed and the names the universe
already uses inside the fleet's sheets.

The fleet spells teams one way ("LA Clippers", "Paris Basketball"),
API vendors spell them another ("Los Angeles Clippers", "Paris Levallois").
If those two strings don't collapse to the same key, H2H / recent-form /
standings lookups silently return nothing and predictions degrade.

Strategy, in order:
  1. exact normalised match
  2. hand-maintained alias table (ingest/team_aliases.json)
  3. token-subset / fuzzy match above a threshold
Unresolved names are reported loudly rather than guessed.
"""

from __future__ import annotations

import json
import logging
import re
import unicodedata
from difflib import SequenceMatcher
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

log = logging.getLogger("ingest.teams")

_ALIAS_PATH = Path(__file__).with_name("team_aliases.json")

# Noise tokens that carry no identity in basketball team names.
_DROP_TOKENS = {
    "bc", "b.c.", "bk", "basket", "basketball", "club", "de", "the",
    "team", "sportif", "sport", "kk", "cb", "sc", "ac", "cp",
}


def normalise(name: str) -> str:
    """Aggressive normalisation used for keying/lookups."""
    if not name:
        return ""
    s = unicodedata.normalize("NFKD", str(name))
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    s = s.lower()
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    tokens = [t for t in s.split() if t and t not in _DROP_TOKENS]
    return " ".join(tokens)


def _load_aliases() -> Dict[str, str]:
    if not _ALIAS_PATH.exists():
        return {}
    try:
        raw = json.loads(_ALIAS_PATH.read_text(encoding="utf-8"))
    except Exception as exc:  # pragma: no cover - corrupt alias file
        log.warning("team_aliases.json unreadable (%s) — ignoring", exc)
        return {}
    return {normalise(k): normalise(v) for k, v in raw.items()}


class TeamResolver:
    """
    Bidirectional resolver.

    `canonical()` maps any spelling to the fleet's preferred spelling, so
    both the API row and the sheet row land on the same key.
    """

    def __init__(self, aliases: Optional[Dict[str, str]] = None):
        self._aliases: Dict[str, str] = dict(_load_aliases())
        if aliases:
            self._aliases.update({normalise(k): normalise(v) for k, v in aliases.items()})
        self._canonical_display: Dict[str, str] = {}
        self._unresolved: List[str] = []

    # ── registration ────────────────────────────────────────────────────

    def learn(self, canonical_name: str) -> str:
        """Register a team name that is authoritative (i.e. came from the fleet)."""
        key = normalise(canonical_name)
        if key:
            self._aliases.setdefault(key, key)
            self._canonical_display.setdefault(key, canonical_name.strip())
        return key

    def learn_many(self, names: Iterable[str]) -> None:
        for n in names:
            self.learn(n)

    # ── resolution ──────────────────────────────────────────────────────

    def key(self, name: str) -> str:
        """Stable identity key for a team name."""
        return self._aliases.get(normalise(name)) or normalise(name)

    def display(self, name: str) -> str:
        """Fleet-preferred spelling, falling back to the input."""
        k = self.key(name)
        return self._canonical_display.get(k, (name or "").strip())

    def same(self, a: str, b: str) -> bool:
        return bool(self.key(a)) and self.key(a) == self.key(b)

    def match(self, name: str, candidates: Iterable[str], threshold: float = 0.86) -> Optional[str]:
        """
        Best candidate for `name`, or None when nothing clears the threshold.
        Records the miss so callers can surface it.
        """
        target = self.key(name)
        best: Tuple[float, Optional[str]] = (0.0, None)
        for cand in candidates:
            ck = self.key(cand)
            if not ck:
                continue
            if ck == target:
                return cand
            score = _similarity(target, ck)
            if score > best[0]:
                best = (score, cand)
        if best[1] is not None and best[0] >= threshold:
            return best[1]
        if name and target:
            self._unresolved.append(name)
        return None

    @property
    def unresolved(self) -> List[str]:
        return list(self._unresolved)

    def drain_unresolved(self) -> List[str]:
        out = list(dict.fromkeys(self._unresolved))
        self._unresolved.clear()
        return out


def _similarity(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    base = SequenceMatcher(None, a, b).ratio()
    ta, tb = set(a.split()), set(b.split())
    if ta and tb:
        jaccard = len(ta & tb) / len(ta | tb)
        # Token overlap is the stronger signal for "LA Clippers" vs "Los Angeles Clippers"
        if ta <= tb or tb <= ta:
            base = max(base, 0.92)
        base = max(base, jaccard * 0.95)
    return base
