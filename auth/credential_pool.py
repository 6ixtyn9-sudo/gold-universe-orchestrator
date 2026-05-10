import time
import logging
from typing import List, Dict, Optional, Any
from auth.google_auth import get_credentials_from_file, SCOPES
from fetcher.script_api_client import ScriptApiClient

logger = logging.getLogger(__name__)

class ScriptCredentialPool:
    def __init__(self, credential_paths: List[str], token_cache_dir: str, interactive_oauth: bool,
                 create_qps: float, update_qps: float, read_qps: float,
                 rotate_on_429: bool = True, max_rotations: int = None, cooldown_seconds: int = 900,
                 strategy: str = "round_robin"):
        self.credential_paths = credential_paths
        self.token_cache_dir = token_cache_dir
        self.interactive_oauth = interactive_oauth
        self.create_qps = create_qps
        self.update_qps = update_qps
        self.read_qps = read_qps
        self.rotate_on_429 = rotate_on_429
        self.max_rotations = max_rotations if max_rotations is not None else len(credential_paths) * 2
        self.cooldown_seconds = cooldown_seconds
        self.strategy = strategy
        
        self.pool: List[Dict[str, Any]] = []
        
        for path in self.credential_paths:
            try:
                creds = get_credentials_from_file(path, self.token_cache_dir, self.interactive_oauth, SCOPES)
                client = ScriptApiClient(credentials=creds, create_qps=self.create_qps, update_qps=self.update_qps, read_qps=self.read_qps)
                email = "unknown"
                try:
                    about = client.drive_service.about().get(fields="user(emailAddress)").execute()
                    email = about.get("user", {}).get("emailAddress", "unknown")
                except Exception:
                    pass
                self.pool.append({
                    "path": path,
                    "email": email,
                    "status": "READY",
                    "cooldown_until": 0,
                    "reason": "",
                    "client": client,
                    "last_used": 0
                })
            except Exception as e:
                logger.error(f"Failed to load credentials from {path}: {e}")
                
        if not self.pool:
            raise Exception("No valid credentials loaded into pool.")
            
        self.current_idx = 0

    def get_active_client(self) -> Optional[ScriptApiClient]:
        now = time.time()
        
        for item in self.pool:
            if item["status"] == "COOLDOWN_UNTIL" and now >= item["cooldown_until"]:
                item["status"] = "READY"
                item["cooldown_until"] = 0
                logger.info(f"Credential {item['path']} cooldown expired. Back to READY.")

        ready_items = [i for i in range(len(self.pool)) if self.pool[i]["status"] == "READY"]
        if not ready_items:
            return None
            
        if self.strategy == "least_recently_used":
            best_idx = min(ready_items, key=lambda idx: self.pool[idx]["last_used"])
            self.current_idx = best_idx
        else:
            if self.current_idx not in ready_items:
                self.current_idx = ready_items[0]
                
        self.pool[self.current_idx]["last_used"] = now
        return self.pool[self.current_idx]["client"]

    def mark_current_cooldown(self):
        item = self.pool[self.current_idx]
        item["status"] = "COOLDOWN_UNTIL"
        item["cooldown_until"] = time.time() + self.cooldown_seconds
        logger.warning(f"Credential {item['path']} exhausted quota (429). Cooling down for {self.cooldown_seconds}s.")
        self.current_idx = (self.current_idx + 1) % len(self.pool)

    def mark_current_disabled(self, reason: str):
        item = self.pool[self.current_idx]
        item["status"] = "DISABLED"
        item["reason"] = reason
        logger.error(f"Credential {item['path']} DISABLED. Reason: {reason}")
        self.current_idx = (self.current_idx + 1) % len(self.pool)

    def execute_with_pool(self, action_name: str, func, *args, **kwargs) -> Any:
        rotations = 0
        while True:
            client = self.get_active_client()
            if not client:
                self.log_pool_status()
                raise Exception(f"Pool exhausted. Cannot execute {action_name}.")
                
            try:
                return func(client, *args, **kwargs)
            except Exception as e:
                import googleapiclient.errors
                if isinstance(e, googleapiclient.errors.HttpError):
                    status = e.resp.status
                    if status == 429:
                        if self.rotate_on_429:
                            self.mark_current_cooldown()
                            rotations += 1
                            if rotations > self.max_rotations:
                                raise Exception(f"Max rotations ({self.max_rotations}) reached for {action_name}. Last error: {e}")
                            continue
                        else:
                            raise
                    elif status in (401, 403):
                        err_str = str(e).lower()
                        if "has not enabled the apps script api" in err_str:
                            self.mark_current_disabled("USERSETTING_DISABLED")
                            continue
                        elif "oauth client was deleted" in err_str:
                            self.mark_current_disabled("DELETED_CLIENT")
                            continue
                        else:
                            self.mark_current_disabled("INSUFFICIENT_PERMISSIONS")
                            continue
                    else:
                        raise
                else:
                    err_str = str(e).lower()
                    if "oauth client was deleted" in err_str:
                        self.mark_current_disabled("DELETED_CLIENT")
                        continue
                    raise

    def log_pool_status(self):
        logger.info("\\n--- Script Credential Pool Status ---")
        cooling = sum(1 for item in self.pool if item['status'] == 'COOLDOWN_UNTIL')
        disabled = sum(1 for item in self.pool if item['status'] == 'DISABLED')
        ready = sum(1 for item in self.pool if item['status'] == 'READY')
        logger.info(f"Pool Summary: {ready} READY, {cooling} COOLING, {disabled} DISABLED")
        for item in self.pool:
            reason = item.get('reason') or (f"until {time.strftime('%H:%M:%S', time.localtime(item['cooldown_until']))}" if item['cooldown_until'] else "")
            logger.info(f"Path: {item['path']} ({item['email']}) | Status: {item['status']} | {reason}")
        logger.info("-------------------------------------\\n")
        
    def get_current_principal_name(self) -> str:
        if 0 <= self.current_idx < len(self.pool):
            return f"{self.pool[self.current_idx]['path']} ({self.pool[self.current_idx]['email']})"
        return "unknown"
