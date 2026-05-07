"""
brain/sheet_writer.py
─────────────────────
Handles writing processed results back to Google Sheets.
Implements service account round-robin to bypass API quotas.
"""

from __future__ import annotations
import logging
import time
import json
import os
from typing import Any, List, Optional

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

log = logging.getLogger("brain.sheet_writer")


class SheetWriter:
    def __init__(self, service_account_dir: str):
        self.creds_dir = service_account_dir
        self.creds_files = [
            os.path.join(service_account_dir, f)
            for f in os.listdir(service_account_dir)
            if f.endswith(".json")
        ]
        self.creds_files.sort()
        self.current_idx = 0
        log.info(f"SheetWriter: found {len(self.creds_files)} service accounts")

    def _get_next_service(self):
        """Rotate to next service account."""
        if not self.creds_files:
            raise FileNotFoundError("No service account JSONs found in directory")

        path = self.creds_files[self.current_idx]
        self.current_idx = (self.current_idx + 1) % len(self.creds_files)

        creds = service_account.Credentials.from_service_account_file(
            path, scopes=["https://www.googleapis.com/auth/spreadsheets"]
        )
        return build("sheets", "v4", credentials=creds)

    def write_tab(
        self,
        spreadsheet_id: str,
        tab_name: str,
        values: List[List[Any]],
        clear: bool = True,
        retries: int = 3,
    ) -> bool:
        """
        Overwrite or append to a tab in Google Sheets.
        """
        if not spreadsheet_id or not tab_name:
            return False

        for attempt in range(retries):
            try:
                service = self._get_next_service()
                sheet_api = service.spreadsheets()

                if clear:
                    sheet_api.values().clear(
                        spreadsheetId=spreadsheet_id, range=f"'{tab_name}'!A1:Z5000"
                    ).execute()

                body = {"values": values}
                sheet_api.values().update(
                    spreadsheetId=spreadsheet_id,
                    range=f"'{tab_name}'!A1",
                    valueInputOption="USER_ENTERED",
                    body=body,
                ).execute()

                log.info(f"✅ Wrote {len(values)} rows to {spreadsheet_id} [{tab_name}]")
                return True

            except HttpError as e:
                log.warning(f"⚠️ Sheet write attempt {attempt+1} failed: {e}")
                if attempt < retries - 1:
                    time.sleep(2 ** attempt)
                else:
                    log.error(f"❌ Failed to write to sheet after {retries} attempts")

            except Exception as e:
                log.error(f"🔥 Unexpected error in sheet writer: {e}")
                break

        return False
