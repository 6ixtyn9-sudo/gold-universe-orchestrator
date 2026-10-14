"""
ingest/providers/api_sports.py
──────────────────────────────
Adapter for API-Sports basketball (v1.basketball.api-sports.io), the vendor
the rest of this migration is designed around.

Why this vendor: it is the only mainstream feed that covers the long tail of
leagues this universe actually bets — Brazil NBB, Latvia-Estonian LEL,
Argentina Liga Femenina, Iceland ISW, Korea KBL — and it returns **quarter
splits**, which the ResultsClean / CleanH2H / quarter-OU machinery needs.

Auth:   header  x-apisports-key: <KEY>     env  API_SPORTS_KEY
Docs:   https://api-sports.io/documentation/basketball/v1

Design notes
  * stdlib urllib only — no new dependency in pyproject.
  * Every response is cached on disk (ingest/.cache) so a repeated run in the
    same window costs zero quota. API-Sports free tier is 100 req/day.
  * `capture=True` dumps the raw JSON untouched, which is how you verify the
    field mapping against a live key without guessing (see docs/API_MIGRATION.md
    "Verify the live mapping").
  * Field extraction is defensive: the vendor has shipped slightly different
    key names between plan tiers, so every read goes through a fallback chain.
"""

from __future__ import annotations

import json
import logging
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from ingest.models import Fixture, GameResult, StandingRow
from ingest.providers.base import DataProvider, NotSupported, ProviderError
from ingest import quotas

log = logging.getLogger("ingest.provider.api_sports")

BASE_URL = "https://v1.basketball.api-sports.io"
DEFAULT_TIMEOUT = 25
MAX_RETRIES = 3
CACHE_TTL_SECONDS = 900  # a fixture list doesn't change every minute


class ApiSportsProvider(DataProvider):
    name = "api_sports"
    supports_standings = True
    supports_odds = False   # odds live in a separate vendor (see providers/odds.py)
    supports_bulk = True    # /games?date= returns every competition in ONE request

    def __init__(
        self,
        api_key: Optional[str] = None,
        cache_dir: str | Path = "ingest/.cache",
        timezone_name: str = "UTC",
        capture: bool = False,
        cache_ttl: int = CACHE_TTL_SECONDS,
        enforce_quota: bool = True,
    ):
        self.api_key = api_key or os.environ.get("API_SPORTS_KEY", "")
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.timezone_name = timezone_name
        self.capture = capture
        self.cache_ttl = cache_ttl
        self.quota_remaining: Optional[str] = None
        self.enforce_quota = enforce_quota
        # how many requests to hold back for the calls that cannot be skipped
        self.quota_reserve = 10

    # ── HTTP ────────────────────────────────────────────────────────────

    def _cache_path(self, path: str, params: Dict[str, Any]) -> Path:
        safe = urllib.parse.quote(path.strip("/"), safe="")
        q = urllib.parse.urlencode(sorted(params.items()))
        return self.cache_dir / f"{safe}__{abs(hash(q)) & 0xFFFFFFFF:08x}.json"

    def _get(self, path: str, params: Dict[str, Any]) -> Any:
        cache_file = self._cache_path(path, params)
        if cache_file.exists() and (time.time() - cache_file.stat().st_mtime) < self.cache_ttl:
            return json.loads(cache_file.read_text(encoding="utf-8"))

        # only unmetered calls reach the network, so only they cost quota
        if self.enforce_quota:
            quotas.ledger().spend(self.name, 1, reserve=self.quota_reserve)

        if not self.api_key:
            raise ProviderError(
                "API_SPORTS_KEY is not set. Export it, or run with the fixture "
                "provider for offline development."
            )

        url = f"{BASE_URL}/{path}?{urllib.parse.urlencode(params)}"
        req = urllib.request.Request(url, headers={
            "x-apisports-key": self.api_key,
            "Accept": "application/json",
            "User-Agent": "gold-universe-orchestrator/ingest",
        })

        last_exc: Optional[Exception] = None
        for attempt in range(MAX_RETRIES):
            try:
                with urllib.request.urlopen(req, timeout=DEFAULT_TIMEOUT) as resp:
                    self.quota_remaining = resp.headers.get("x-ratelimit-requests-remaining")
                    payload = json.loads(resp.read().decode("utf-8"))
                break
            except urllib.error.HTTPError as exc:
                last_exc = exc
                if exc.code in (401, 403):
                    raise ProviderError(f"API-Sports auth failed ({exc.code}) — check API_SPORTS_KEY") from exc
                if exc.code == 429:
                    wait = 2 ** attempt * 5
                    log.warning("API-Sports rate limit hit — sleeping %ss", wait)
                    time.sleep(wait)
                    continue
                raise ProviderError(f"API-Sports HTTP {exc.code} for {path}") from exc
            except Exception as exc:  # noqa: BLE001 - network layer
                last_exc = exc
                time.sleep(2 ** attempt)
        else:  # pragma: no cover - retries exhausted
            raise ProviderError(f"API-Sports request failed after {MAX_RETRIES} tries: {last_exc}")

        errors = payload.get("errors")
        if errors:
            raise ProviderError(f"API-Sports reported errors: {errors}")

        if self.capture:
            raw_file = self.cache_dir / f"raw__{cache_file.name}"
            raw_file.write_text(json.dumps(payload, indent=2), encoding="utf-8")

        cache_file.write_text(json.dumps(payload), encoding="utf-8")
        return payload

    # ── games ───────────────────────────────────────────────────────────

    def _games(self, params: Dict[str, Any]) -> List[Dict[str, Any]]:
        return list(self._get("games", params).get("response") or [])

    # ── bulk mode ───────────────────────────────────────────────────────

    def bulk_day(self, date_iso: str) -> List[Dict[str, Any]]:
        """
        EVERY competition's games for one date, in a single request.

        This is what makes a 100 req/day free key viable for a 166-league
        fleet: one call returns all of a day's fixtures *and* finals (with
        quarter splits), each tagged with its league id/name/country. The
        caller maps those to fleet leagues and never needs 166 requests.

        Returns a list of per-vendor-league groups:
            [{vendor_league_id, vendor_league_name, vendor_country,
              fixtures: [Fixture], results: [GameResult]}, ...]
        """
        payload = self._get("games", {"date": date_iso, "timezone": self.timezone_name})
        return self.group_games(payload.get("response") or [])

    def group_games(self, games: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Group raw vendor games by league into canonical fixtures/results."""
        grouped: Dict[Any, Dict[str, Any]] = {}
        for raw in games:
            league = raw.get("league") or {}
            country = raw.get("country") or {}
            vid = league.get("id")
            bucket = grouped.setdefault(vid, {
                "vendor_league_id": vid,
                "vendor_league_name": str(league.get("name") or ""),
                "vendor_country": str(country.get("name") or ""),
                "vendor_season": str(league.get("season") or ""),
                "league_key": f"vendor:{vid}",
                "league_display": str(league.get("name") or ""),
                "fixtures": [],
                "results": [],
            })
            parsed = self._parse_game(raw, bucket["league_key"])
            if parsed["fixture"] is not None:
                bucket["fixtures"].append(parsed["fixture"])
            if parsed["result"] is not None:
                bucket["results"].append(parsed["result"])
        return list(grouped.values())

    def fixtures(self, league_key: str, date_from: str, date_to: str) -> List[Fixture]:
        league_id, season = _league_params(league_key)
        out: List[Fixture] = []
        for day in _date_range(date_from, date_to):
            params: Dict[str, Any] = {"date": day, "timezone": self.timezone_name}
            if league_id:
                params["league"] = league_id
            if season:
                params["season"] = season
            for raw in self._games(params):
                parsed = self._parse_game(raw, league_key)
                if parsed["fixture"] is not None:
                    out.append(parsed["fixture"])
        return out

    def results(self, league_key: str, date_from: str, date_to: str) -> List[GameResult]:
        """Completed games in a window. In bulk mode the caller passes these in
        (see bulk_day) and this is never called."""
        league_id, season = _league_params(league_key)
        out: List[GameResult] = []
        for day in _date_range(date_from, date_to):
            params: Dict[str, Any] = {"date": day, "timezone": self.timezone_name}
            if league_id:
                params["league"] = league_id
            if season:
                params["season"] = season
            for raw in self._games(params):
                parsed = self._parse_game(raw, league_key)
                if parsed["result"] is not None and parsed["finished"]:
                    out.append(parsed["result"])
        return out

    def team_history(
        self, league_key: str, team: str, before: str, limit: int = 10
    ) -> List[GameResult]:
        team_id = self._team_id(league_key, team)
        if not team_id:
            return []
        season = _league_params(league_key)[1]
        params: Dict[str, Any] = {"team": team_id, "timezone": self.timezone_name}
        if season:
            params["season"] = season
        out: List[GameResult] = []
        for raw in self._games(params):
            parsed = self._parse_game(raw, league_key)
            if not parsed["finished"] or parsed["result"] is None:
                continue
            if before and parsed["result"].date >= before:
                continue
            out.append(parsed["result"])
        out.sort(key=lambda r: r.date, reverse=True)
        return out[:limit]

    def h2h(
        self, league_key: str, home: str, away: str, before: str, limit: int = 10
    ) -> List[GameResult]:
        hid = self._team_id(league_key, home)
        aid = self._team_id(league_key, away)
        if not hid or not aid:
            return []
        out: List[GameResult] = []
        for raw in self._games({"h2h": f"{hid}-{aid}", "timezone": self.timezone_name}):
            parsed = self._parse_game(raw, league_key)
            if not parsed["finished"] or parsed["result"] is None:
                continue
            if before and parsed["result"].date >= before:
                continue
            out.append(parsed["result"])
        out.sort(key=lambda r: r.date, reverse=True)
        return out[:limit]

    # ── standings ───────────────────────────────────────────────────────

    def standings(self, league_key: str, season: str = "") -> List[StandingRow]:
        league_id, season_default = _league_params(league_key)
        if not league_id:
            raise NotSupported(f"no API-Sports league id mapped for '{league_key}'")
        payload = self._get("standings", {
            "league": league_id,
            "season": season or season_default,
        })
        rows: List[StandingRow] = []
        for entry in payload.get("response") or []:
            section = entry.get("conference") or entry.get("division") or entry.get("group") or ""
            if isinstance(section, dict):
                section = section.get("name") or ""
            team = (entry.get("team") or {})
            games = entry.get("games") or {}
            win = games.get("win") or {}
            lose = games.get("lose") or {}
            points = entry.get("points") or {}
            pf = _dig(points, "for", "total") or _dig(points, "for", "average")
            pa = _dig(points, "against", "total") or _dig(points, "against", "average")
            rows.append(StandingRow(
                team=str(team.get("name") or ""),
                section=str(section or ""),
                position=str(entry.get("position") or ""),
                gp=_as_int(games.get("played")),
                w=_as_int(win.get("total")),
                l=_as_int(lose.get("total")),
                pct=_as_pct(win.get("percentage")),
                pf=_as_float(pf),
                pa=_as_float(pa),
                streak=str(entry.get("win_streak") or ""),
                l10=str(entry.get("l10") or ""),
                home_record=str((entry.get("home") or {}).get("record") or ""),
                away_record=str((entry.get("away") or {}).get("record") or ""),
                league_key=league_key,
            ))
        return rows

    # ── teams ───────────────────────────────────────────────────────────

    def _team_id(self, league_key: str, team: str) -> Optional[int]:
        wanted = _norm(team)
        for entry in self.teams(league_key):
            name = str((entry.get("name") or ""))
            if _norm(name) == wanted:
                return _as_int(entry.get("id"))
        # fall back to a contains-match on the last significant token
        for entry in self.teams(league_key):
            if wanted and wanted in _norm(str(entry.get("name") or "")):
                return _as_int(entry.get("id"))
        log.warning("no API-Sports team id for '%s' in league '%s'", team, league_key)
        return None

    def teams(self, league_key: str) -> List[Dict[str, Any]]:
        league_id, season = _league_params(league_key)
        if not league_id:
            return []
        payload = self._get("teams", {"league": league_id, "season": season})
        return list(payload.get("response") or [])

    # ── parsing ─────────────────────────────────────────────────────────

    def _parse_game(self, raw: Dict[str, Any], league_key: str) -> Dict[str, Any]:
        """Normalise one API-Sports game into Fixture and/or GameResult."""
        teams = raw.get("teams") or {}
        home = str((teams.get("home") or {}).get("name") or "")
        away = str((teams.get("away") or {}).get("name") or "")
        if not home or not away:
            return {"fixture": None, "result": None, "finished": False}

        status_short = str((raw.get("status") or {}).get("short") or "")
        finished = status_short in {"FT", "AOT", "AP", "Finished", "After Over Time"}
        date_iso, time_hhmm = _split_datetime(raw.get("date"), raw.get("time"))
        league_meta = raw.get("league") or {}
        display = str(league_meta.get("name") or "")

        scores = raw.get("scores") or {}
        hs, as_ = scores.get("home") or {}, scores.get("away") or {}

        q = [
            _as_int(hs.get("quarter_1")), _as_int(as_.get("quarter_1")),
            _as_int(hs.get("quarter_2")), _as_int(as_.get("quarter_2")),
            _as_int(hs.get("quarter_3")), _as_int(as_.get("quarter_3")),
            _as_int(hs.get("quarter_4")), _as_int(as_.get("quarter_4")),
        ]
        ot_h = _as_int(hs.get("over_time"))
        ot_a = _as_int(as_.get("over_time"))

        result: Optional[GameResult] = None
        if any(v is not None for v in q) or _as_int(hs.get("total")) is not None:
            result = GameResult(
                league_key=league_key,
                league_display=display,
                date=date_iso,
                time=time_hhmm,
                home=home,
                away=away,
                game_type=str(raw.get("stage") or "Regular"),
                q1h=q[0], q1a=q[1], q2h=q[2], q2a=q[3],
                q3h=q[4], q3a=q[5], q4h=q[6], q4a=q[7],
                oth=ot_h, ota=ot_a,
                provider=self.name,
                provider_fixture_id=str(raw.get("id") or ""),
                status=status_short or "FT",
            )
            # Trust the vendor's final total if quarter splits are missing/incomplete.
            if result.ft_h is None or result.ft_a is None:
                result = _rescue_from_total(result, _as_int(hs.get("total")), _as_int(as_.get("total")))
            if not finished:
                result = None

        fixture: Optional[Fixture] = None
        if not finished:
            fixture = Fixture(
                league_key=league_key,
                league_display=display,
                date=date_iso,
                time=time_hhmm,
                home=home,
                away=away,
                game_type=str(raw.get("stage") or "Regular"),
                provider=self.name,
                provider_fixture_id=str(raw.get("id") or ""),
                status=status_short,
            )

        return {"fixture": fixture, "result": result, "finished": finished}


# ─────────────────────────────────────────────────────────────────────────
# helpers
# ─────────────────────────────────────────────────────────────────────────

def _league_params(league_key: str) -> tuple[Optional[int], str]:
    """Resolve a canonical league key to (api_sports_league_id, season)."""
    try:
        from ingest.leagues import resolve
    except Exception:  # pragma: no cover - cyclic import guard
        return None, ""
    spec = resolve(league_key)
    if not spec:
        return None, ""
    return spec.api_league_id, spec.season


def _date_range(date_from: str, date_to: str) -> List[str]:
    try:
        start = datetime.strptime(date_from[:10], "%Y-%m-%d").date()
        end = datetime.strptime(date_to[:10], "%Y-%m-%d").date()
    except ValueError:
        return [date_from[:10]]
    if end < start:
        start, end = end, start
    days = (end - start).days
    return [(start + timedelta(days=i)).isoformat() for i in range(days + 1)]


def _split_datetime(date_field: Any, time_field: Any) -> tuple[str, str]:
    """API-Sports gives ISO8601 ('2026-10-14T18:30:00+00:00') plus a 'time' field."""
    iso = str(date_field or "")
    date_iso = iso[:10]
    time_hhmm = str(time_field or "")[:5]
    if not time_hhmm and len(iso) >= 16 and iso[10] == "T":
        time_hhmm = iso[11:16]
    return date_iso, time_hhmm


def _rescue_from_total(result: GameResult, total_h: Optional[int], total_a: Optional[int]) -> GameResult:
    """When quarter splits are absent but a final total exists, keep the total.

    The Brain derives FT from quarters, so a missing split would silently drop
    the game.  We stash the total in Q4 as a last resort and mark the row so the
    data-quality report can flag it.
    """
    if result.ft_h is None and total_h is not None:
        result.q4h = total_h
    if result.ft_a is None and total_a is not None:
        result.q4a = total_a
    result.status = (result.status or "FT") + "|TOTAL_ONLY"
    return result


def _norm(s: str) -> str:
    from ingest.teams import normalise
    return normalise(s)


def _as_int(v: Any) -> Optional[int]:
    if v is None or v == "":
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        try:
            return int(float(v))
        except (TypeError, ValueError):
            return None


def _as_float(v: Any) -> Optional[float]:
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _as_pct(v: Any) -> Optional[float]:
    """API-Sports returns win percentage as '.695' or '0.695' — normalise to 0..1."""
    f = _as_float(v)
    if f is None:
        return None
    if f > 1.0:
        f = f / 100.0
    return f


def _dig(d: Any, *keys: str) -> Any:
    cur = d
    for k in keys:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(k)
    return cur
