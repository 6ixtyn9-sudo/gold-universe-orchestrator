from __future__ import annotations

import random
import time
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional, Tuple

from google.oauth2 import service_account

try:
    from googleapiclient.discovery import build
    from googleapiclient.errors import HttpError
except Exception as e:  # pragma: no cover
    raise RuntimeError(
        "google-api-python-client is required. Install: pip install google-api-python-client"
    ) from e


RETRY_STATUS = {429, 500, 502, 503, 504}


@dataclass
class RateLimiter:
    min_interval_s: float = 1.1
    _last_ts: float = 0.0

    def wait(self) -> None:
        now = time.time()
        delta = now - self._last_ts
        if delta < self.min_interval_s:
            time.sleep(self.min_interval_s - delta)
        self._last_ts = time.time()


def _http_status(err: Exception) -> Optional[int]:
    if isinstance(err, HttpError):
        try:
            return int(err.resp.status)
        except Exception:
            return None
    return None


def execute_with_backoff(
    request,
    limiter: Optional[RateLimiter] = None,
    max_attempts: int = 8,
    base_delay_s: float = 1.0,
    max_delay_s: float = 30.0,
) -> Any:
    attempt = 0
    while True:
        attempt += 1
        if limiter:
            limiter.wait()
        try:
            return request.execute()
        except Exception as e:
            status = _http_status(e)
            retryable = status in RETRY_STATUS

            if (not retryable) or attempt >= max_attempts:
                raise

            delay = min(max_delay_s, base_delay_s * (2 ** (attempt - 1)))
            delay = delay * (0.7 + random.random() * 0.6)  # jitter 0.7x..1.3x
            time.sleep(delay)


class SheetsApiClient:
    def __init__(
        self,
        service_account_file: str = "service_account.json",
        min_interval_s: float = 1.1,
    ) -> None:
        scopes = [
            "https://www.googleapis.com/auth/spreadsheets.readonly",
            "https://www.googleapis.com/auth/drive.readonly",
        ]
        creds = service_account.Credentials.from_service_account_file(
            service_account_file, scopes=scopes
        )
        self._service = build(
            "sheets",
            "v4",
            credentials=creds,
            cache_discovery=False,
        )
        self._limiter = RateLimiter(min_interval_s=min_interval_s)

    def spreadsheet_meta(self, spreadsheet_id: str) -> Dict[str, Any]:
        req = self._service.spreadsheets().get(
            spreadsheetId=spreadsheet_id,
            includeGridData=False,
            fields="spreadsheetId,properties(title),sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))",
        )
        return execute_with_backoff(req, limiter=self._limiter)

    def list_sheet_titles(self, spreadsheet_id: str) -> List[str]:
        meta = self.spreadsheet_meta(spreadsheet_id)
        sheets = meta.get("sheets", []) or []
        return [s["properties"]["title"] for s in sheets if s.get("properties", {}).get("title")]

    def batch_get_values(
        self,
        spreadsheet_id: str,
        ranges: List[str],
        value_render_option: str = "UNFORMATTED_VALUE",
    ) -> Dict[str, Any]:
        req = self._service.spreadsheets().values().batchGet(
            spreadsheetId=spreadsheet_id,
            ranges=ranges,
            valueRenderOption=value_render_option,
        )
        return execute_with_backoff(req, limiter=self._limiter)

    def get_header_row(
        self, spreadsheet_id: str, tab_name: str, max_cols: int = 160
    ) -> List[Any]:
        end_col = self._col_to_a1(max_cols)
        rng = f"'{tab_name}'!A1:{end_col}1"
        resp = self.batch_get_values(spreadsheet_id, [rng])
        vrs = (resp.get("valueRanges") or [])
        if not vrs:
            return []
        values = vrs[0].get("values") or []
        return values[0] if values else []

    @staticmethod
    def _col_to_a1(n: int) -> str:
        s = ""
        while n:
            n, r = divmod(n - 1, 26)
            s = chr(65 + r) + s
        return s
