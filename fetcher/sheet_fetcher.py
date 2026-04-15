import time
import logging

logger = logging.getLogger(__name__)

RATE_LIMIT_DELAY = 1.1  # seconds between API calls

GOLD_UNIVERSE_SHEETS = {"Side", "Totals", "MA_Vault", "MA_Discovery", "MA_Logs"}
LEGACY_SHEETS = {"Predictions", "Results", "BetSlips", "Accuracy"}
SIDE_NAMES = {"Side", "side"}
TOTALS_NAMES = {"Totals", "totals"}
RESULTS_NAMES = {"ResultsClean", "Results", "results"}


def _sheet_to_dicts(ws):
    """Convert a gspread worksheet to list of dicts."""
    try:
        records = ws.get_all_records(numericise_ignore=["all"])
        return records
    except Exception as e:
        logger.warning(f"get_all_records failed for {ws.title}: {e}")
        try:
            vals = ws.get_all_values()
            if not vals:
                return []
            headers = [str(h).strip() for h in vals[0]]
            return [
                {headers[i]: row[i] if i < len(row) else "" for i in range(len(headers))}
                for row in vals[1:]
            ]
        except Exception as e2:
            logger.error(f"Fallback also failed for {ws.title}: {e2}")
            return []


def detect_format(sheet_titles):
    """Detect whether a satellite uses Gold Universe or Legacy format."""
    title_set = set(sheet_titles)
    gold_matches = len(GOLD_UNIVERSE_SHEETS & title_set)
    legacy_matches = len(LEGACY_SHEETS & title_set)
    if gold_matches >= 2:
        return "gold_universe"
    if legacy_matches >= 2:
        return "legacy"
    return "unknown"


def fetch_satellite(client, sat):
    """
    Fetch data from a satellite Google Sheet.

    Returns a payload dict:
    {
      "satellite": {...sat metadata...},
      "format": "gold_universe" | "legacy" | "unknown",
      "data": {
        "side": [...],
        "totals": [...],
        "results": [...],
      },
      "sheet_titles": [...],
      "error": None | str
    }
    """
    sheet_id = sat.get("sheet_id", "")
    sat_name = sat.get("sheet_name") or sat.get("league") or sheet_id

    logger.info(f"Fetching satellite: {sat_name} ({sheet_id})")

    payload = {
        "satellite": sat,
        "format": "unknown",
        "data": {"side": [], "totals": [], "results": []},
        "sheet_titles": [],
        "error": None,
    }

    try:
        spreadsheet = client.open_by_key(sheet_id)
        time.sleep(RATE_LIMIT_DELAY)

        worksheets = spreadsheet.worksheets()
        titles = [ws.title for ws in worksheets]
        payload["sheet_titles"] = titles

        fmt = detect_format(titles)
        payload["format"] = fmt

        ws_map = {ws.title: ws for ws in worksheets}

        if fmt == "gold_universe":
            for name in SIDE_NAMES:
                if name in ws_map:
                    payload["data"]["side"] = _sheet_to_dicts(ws_map[name])
                    time.sleep(RATE_LIMIT_DELAY)
                    break

            for name in TOTALS_NAMES:
                if name in ws_map:
                    payload["data"]["totals"] = _sheet_to_dicts(ws_map[name])
                    time.sleep(RATE_LIMIT_DELAY)
                    break

            for name in RESULTS_NAMES:
                if name in ws_map:
                    payload["data"]["results"] = _sheet_to_dicts(ws_map[name])
                    time.sleep(RATE_LIMIT_DELAY)
                    break

        elif fmt == "legacy":
            if "Predictions" in ws_map:
                payload["data"]["side"] = _sheet_to_dicts(ws_map["Predictions"])
                time.sleep(RATE_LIMIT_DELAY)
            if "Results" in ws_map:
                payload["data"]["results"] = _sheet_to_dicts(ws_map["Results"])
                time.sleep(RATE_LIMIT_DELAY)

        else:
            # Unknown — try to grab anything that looks useful
            for ws in worksheets[:3]:
                rows = _sheet_to_dicts(ws)
                if rows:
                    payload["data"]["side"].extend(rows)
                time.sleep(RATE_LIMIT_DELAY)

        total_rows = (
            len(payload["data"]["side"])
            + len(payload["data"]["totals"])
            + len(payload["data"]["results"])
        )
        logger.info(
            f"Fetched {sat_name}: format={fmt}, "
            f"side={len(payload['data']['side'])}, "
            f"totals={len(payload['data']['totals'])}, "
            f"results={len(payload['data']['results'])}, "
            f"total_rows={total_rows}"
        )

    except Exception as e:
        logger.error(f"Error fetching {sat_name}: {e}")
        payload["error"] = str(e)

    return payload


def batch_fetch(client, satellites, on_progress=None):
    """
    Fetch multiple satellites with rate limiting.

    on_progress(done, total, sat, error) called after each fetch.
    Returns list of payloads.
    """
    results = []
    total = len(satellites)

    for i, sat in enumerate(satellites):
        payload = fetch_satellite(client, sat)
        results.append({"satellite": sat, "payload": payload})

        if on_progress:
            try:
                on_progress(i + 1, total, sat, payload.get("error"))
            except Exception:
                pass

    return results
