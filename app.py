import logging
import threading
import json
import os
from datetime import datetime

from flask import Flask, render_template, request, jsonify

from auth.google_auth import get_client, reset_client, is_configured
from registry.satellite_registry import (
    list_satellites, get_satellite, add_satellite, bulk_add,
    remove_satellite, update_satellite, summary_stats,
)
from fetcher.sheet_fetcher import fetch_satellite, batch_fetch
from assayer.assayer_engine import run_full_assay
from assayer.smoke_assay import run_smoke_assay

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

app = Flask(__name__)

_job_status = {}
_job_lock = threading.Lock()


def _set_job(job_id, state, detail="", result=None):
    with _job_lock:
        _job_status[job_id] = {
            "state": state,
            "detail": detail,
            "result": result,
            "updated_at": datetime.utcnow().isoformat(),
        }


def _get_job(job_id):
    with _job_lock:
        return _job_status.get(job_id)


# ─────────────────────────────────────────────────────────────────────────────
# Dashboard
# ─────────────────────────────────────────────────────────────────────────────

@app.route("/")
def dashboard():
    stats = summary_stats()
    sats = list_satellites()
    configured = is_configured()
    return render_template(
        "dashboard.html",
        stats=stats,
        satellites=sats,
        configured=configured,
        now=datetime.utcnow().isoformat(),
    )


# ─────────────────────────────────────────────────────────────────────────────
# Status
# ─────────────────────────────────────────────────────────────────────────────


@app.route("/leagues")
def leagues_page():
    """League purity browser page"""
    return render_template("leagues.html")

@app.route("/api/status")
def api_status():
    configured = is_configured()
    stats = summary_stats()
    return jsonify({
        "configured": configured,
        "stats": stats,
        "timestamp": datetime.utcnow().isoformat(),
    })


# ─────────────────────────────────────────────────────────────────────────────
# Satellites CRUD
# ─────────────────────────────────────────────────────────────────────────────

@app.route("/api/satellites", methods=["GET"])
def api_satellites():
    date = request.args.get("date")
    league = request.args.get("league")
    fmt = request.args.get("format")
    sats = list_satellites(date=date, league=league, fmt=fmt)
    return jsonify({"satellites": sats, "count": len(sats)})


@app.route("/api/satellites/add", methods=["POST"])
def api_add_satellite():
    body = request.json or {}
    sheet_id = body.get("sheet_id", "").strip()
    if not sheet_id:
        return jsonify({"error": "sheet_id is required"}), 400

    sheet_name = body.get("sheet_name", "").strip()
    date = body.get("date", "").strip()
    league = body.get("league", "").strip()
    notes = body.get("notes", "").strip()

    sat, created = add_satellite(
        sheet_id=sheet_id,
        sheet_name=sheet_name,
        date=date,
        league=league,
        notes=notes,
    )
    return jsonify({"satellite": sat, "created": created})


@app.route("/api/satellites/bulk-add", methods=["POST"])
def api_bulk_add():
    body = request.json or {}
    entries = body.get("entries", [])
    if not entries:
        return jsonify({"error": "entries list is required"}), 400

    results = bulk_add(entries)
    created = sum(1 for r in results if r.get("created"))
    return jsonify({"results": results, "created": created, "total": len(results)})


@app.route("/api/satellites/<sat_id>", methods=["GET"])
def api_get_satellite(sat_id):
    sat = get_satellite(sat_id)
    if not sat:
        return jsonify({"error": "satellite not found"}), 404
    return jsonify(sat)


@app.route("/api/satellites/<sat_id>", methods=["DELETE"])
def api_delete_satellite(sat_id):
    removed = remove_satellite(sat_id)
    if not removed:
        return jsonify({"error": "satellite not found"}), 404
    return jsonify({"removed": True, "id": sat_id})


# ─────────────────────────────────────────────────────────────────────────────
# Fetch & Assay — single satellite
# ─────────────────────────────────────────────────────────────────────────────

@app.route("/api/fetch/<sat_id>", methods=["POST"])
def api_fetch_one(sat_id):
    if not is_configured():
        return jsonify({"error": "Google auth not configured — add GOOGLE_SERVICE_ACCOUNT_JSON secret"}), 503

    sat = get_satellite(sat_id)
    if not sat:
        return jsonify({"error": "satellite not found"}), 404

    try:
        client = get_client()
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 503

    payload = fetch_satellite(client, sat)

    update_satellite(sat_id, {
        "last_fetched": datetime.utcnow().isoformat(),
        "format": payload.get("format", "unknown"),
    })

    payload_trimmed = {k: v for k, v in payload.items() if k != "data"}
    payload_trimmed["row_counts"] = {
        k: len(v) for k, v in payload.get("data", {}).items()
    }
    return jsonify(payload_trimmed)


@app.route("/api/assay/<sat_id>", methods=["POST"])
def api_assay_one(sat_id):
    if not is_configured():
        return jsonify({"error": "Google auth not configured"}), 503

    sat = get_satellite(sat_id)
    if not sat:
        return jsonify({"error": "satellite not found"}), 404

    try:
        client = get_client()
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 503

    payload = fetch_satellite(client, sat)
    result = run_full_assay(payload)
    summary = result["summary"]

    update_satellite(sat_id, {
        "last_fetched": datetime.utcnow().isoformat(),
        "last_assayed": datetime.utcnow().isoformat(),
        "format": payload.get("format", "unknown"),
        "assay_summary": summary,
    })

    return jsonify({
        "satellite_id": sat_id,
        "summary": summary,
        "league_purity": result["league_purity"],
        "edge_count": len(result["edges"]),
        "top_edges": result["edges"][:20],
    })


# ─────────────────────────────────────────────────────────────────────────────
# Batch Fetch All
# ─────────────────────────────────────────────────────────────────────────────


# -----------------------------------------------------------------------------
# Smoke Assay (bundle-based)
# -----------------------------------------------------------------------------


# -----------------------------------------------------------------------------
# Smoke Assay (bundle-based)
# -----------------------------------------------------------------------------

@app.route("/api/assay-smoke", methods=["POST"])
def api_assay_smoke():
    if not is_configured():
        return jsonify({"error": "Google auth not configured — add GOOGLE_SERVICE_ACCOUNT_JSON sect"}), 503

    data = request.get_json(silent=True) or {}
    sheet_id = (data.get("sheet_id") or data.get("spreadsheet_id") or "").strip()
    if not sheet_id:
        return jsonify({"error": "sheet_id is required"}), 400

    use_cache = bool(data.get("use_cache", True))
    include_patterns = bool(data.get("include_patterns", False))

    try:
        min_interval_s = float(data.get("min_interval_s", 1.2))
    except Exception:
        min_interval_s = 1.2

    scopes = [
        "https://www.googleapis.com/auth/spreadsheets.readonly",
        "https://www.googleapis.com/auth/drive.readonly",
    ]
    try:
        from auth.google_auth import get_service_account_credentials
        creds = get_service_account_credentials(scopes)
    except Exception as e:
        return jsonify({"error": str(e)}), 503

    try:
        report = run_smoke_assay(
            sheet_id,
            use_cache=use_cache,
            include_patterns=include_patterns,
            min_interval_s=min_interval_s,
            credentials=creds,
        )
        return jsonify(report)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": "assay-smoke failed", "detail": str(e)}), 500


@app.route("/api/leagues", methods=["GET"])
def api_leagues():
    import math
    from pathlib import Path

    # Query params
    use_cache = request.args.get("use_cache", "true").lower() != "false"
    cache_only = request.args.get("cache_only", "false").lower() == "true"
    try:
        max_sats = int(request.args.get("max_sats", "50"))
    except Exception:
        max_sats = 50
    try:
        min_graded = int(request.args.get("min_graded", "5"))
    except Exception:
        min_graded = 5

    sats = list_satellites()
    sats = sats[:max_sats] if max_sats > 0 else sats

    # Credentials: required unless cache_only=true
    creds = None
    if is_configured():
        scopes = [
            "https://www.googleapis.com/auth/spreadsheets.readonly",
            "https://www.googleapis.com/auth/drive.readonly",
        ]
        try:
            from auth.google_auth import get_service_account_credentials
            creds = get_service_account_credentials(scopes)
        except Exception as e:
            if not cache_only:
                return jsonify({"error": str(e)}), 503
    else:
        if not cache_only:
            return jsonify({"error": "Google auth not configured — add GOOGLE_SERVICE_ACCOUNT_JSON secret"}), 503

    def wilson_lower(hits: int, n: int, z: float = 16) -> float:
        if n <= 0:
            return 0.0
        p = hits / n
        denom = 1.0 + (z * z / n)
        centre = p + (z * z) / (2.0 * n)
        margin = z * math.sqrt((p * (1 - p) / n) + (z * z) / (4.0 * n * n))
        return (centre - margin) / denom

    league_totals = {}  # league -> {hits, graded}
    errors = []
    sats_used = 0

    for sat in sats:
        sheet_id = (sat.get("sheet_id") or "").strip()
        if not sheet_id:
            continue

        if cache_only:
            manifest = Path("cache/satellites") / sheet_id / "manifest.json"
            if not manifest.exists():
                continue

        try:
            rep = run_smoke_assay(
                sheet_id,
                use_cache=use_cache,
                credentials=creds,
            )
            sats_used += 1
            for row in rep.get("leagues", []) or []:
                lg = (row.get("league") or "Unknown").strip() or "Unknown"
                hits = int(row.get("hits") or 0)
                graded = int(row.get("graded") or 0)
                agg = league_totals.setdefault(lg, {"league": lg, "hits": 0, "graded": 0})
                agg["hits"] += hits
                agg["graded"] += graded
        except Exception as e:
            errors.append({"sheet_id": sheet_id, "error": str(e)})

    leagues = []
    for lg, agg in league_totals.items():
        n = int(agg["graded"])
        if n < min_graded:
            continue
        h = int(agg["hits"])
        hr = (h / n) if n else 0.0
        leagues.append({
            "league": lg,
            "graded": n,
            "hits": h,
            "hit_rate": hr,
            "wilson_lower_95": wilson_lower(h, n),
        })

    leagues.sort(key=lambda x: (x["wilson_lower_95"], x["graded"]), reverse=True)

    return jsonify({
        "leagues": leagues,
        "satellites_total": len(sats),
        "satellites_used": sats_used,
        "errors": errors[:50],
        "timestamp": datetime.utcnow().isoformat(),
        "params": {
            "use_cache": use_cache,
            "cache_only": cache_only,
            "max_sats": max_sats,
            "min_graded": min_graded,
        },
    })




@app.route("/api/fetch-all", methods=["POST"])
def api_fetch_all():
    if not is_configured():
        return jsonify({"error": "Google auth not configured"}), 503

    sats = list_satellites()
    if not sats:
        return jsonify({"error": "No satellites registered"}), 400

    job_id = f"fetch_all_{datetime.utcnow().strftime('%H%M%S')}"
    _set_job(job_id, "running", f"Starting fetch of {len(sats)} satellites")

    def _run():
        try:
            client = get_client()
        except RuntimeError as e:
            _set_job(job_id, "error", str(e))
            return

        success = 0
        errors = 0

        def on_progress(done, total, sat, error):
            nonlocal success, errors
            if error:
                errors += 1
            else:
                success += 1
            msg = f"[{done}/{total}] {sat.get('league', '')} {sat.get('date', '')}"
            _set_job(job_id, "running", msg)

        results = batch_fetch(client, sats, on_progress=on_progress)

        for r in results:
            sat = r["satellite"]
            sat_id = sat["id"]
            p = r["payload"]
            update_satellite(sat_id, {
                "last_fetched": datetime.utcnow().isoformat(),
                "format": p.get("format", "unknown"),
            })

        _set_job(job_id, "done",
                 f"Fetch complete: {success} succeeded, {errors} failed",
                 {"success": success, "errors": errors})

    t = threading.Thread(target=_run, daemon=True)
    t.start()

    return jsonify({"job_id": job_id, "satellites": len(sats)})


# ─────────────────────────────────────────────────────────────────────────────
# Batch Assay All
# ─────────────────────────────────────────────────────────────────────────────

@app.route("/api/assay-all", methods=["POST"])
def api_assay_all():
    if not is_configured():
        return jsonify({"error": "Google auth not configured"}), 503

    sats = list_satellites()
    if not sats:
        return jsonify({"error": "No satellites registered"}), 400

    job_id = f"assay_all_{datetime.utcnow().strftime('%H%M%S')}"
    _set_job(job_id, "running", f"Starting full assay of {len(sats)} satellites")

    def _run():
        try:
            client = get_client()
        except RuntimeError as e:
            _set_job(job_id, "error", str(e))
            return

        total = len(sats)
        success = 0
        errors = 0

        for i, sat in enumerate(sats):
            sat_id = sat["id"]
            _set_job(job_id, "running",
                     f"[{i+1}/{total}] Assaying {sat.get('league','')} {sat.get('date','')}")
            try:
                payload = fetch_satellite(client, sat)
                result = run_full_assay(payload)
                summary = result["summary"]
                update_satellite(sat_id, {
                    "last_fetched": datetime.utcnow().isoformat(),
                    "last_assayed": datetime.utcnow().isoformat(),
                    "format": payload.get("format", "unknown"),
                    "assay_summary": summary,
                })
                success += 1
            except Exception as e:
                logger.error(f"Assay failed for {sat_id}: {e}")
                errors += 1

        _set_job(job_id, "done",
                 f"Assay complete: {success} succeeded, {errors} failed",
                 {"success": success, "errors": errors})

    t = threading.Thread(target=_run, daemon=True)
    t.start()

    return jsonify({"job_id": job_id, "satellites": len(sats)})


@app.route("/api/sync-scripts", methods=["POST"])
def api_sync_scripts():
    """
    Push local .gs files to all satellite sheets.
    """
    sats = list_satellites()
    if not sats:
        return jsonify({"error": "No satellites in registry"}), 400

    job_id = f"sync_scripts_{datetime.utcnow().strftime('%H%M%S')}"
    _set_job(job_id, "running", f"Starting script sync for {len(sats)} satellites")

    def _run():
        try:
            from fetcher.script_api_client import ScriptApiClient
            from scripts.deploy_gs_to_satellites import load_local_gs_files, deploy_to_satellite
            from pathlib import Path

            client = ScriptApiClient()
            docs_dir = Path(os.path.dirname(__file__)) / "Ma_Golide_Satellites" / "docs"
            files = load_local_gs_files(docs_dir)
            
            success = 0
            for i, sat in enumerate(sats):
                try:
                    deploy_to_satellite(client, sat["id"], files, dry_run=False)
                    success += 1
                    _set_job(job_id, "running", f"[{i+1}/{len(sats)}] Synced {sat.get('league')} {sat.get('date')}")
                    time.sleep(1.5) # Rate limit safety
                except Exception as e:
                    logger.error(f"Sync error for {sat['id']}: {e}")
                    _set_job(job_id, "running", f"[{i+1}/{len(sats)}] FAILED {sat.get('league')}: {e}")

            _set_job(job_id, "done", f"Script sync complete: {success}/{len(sats)} successful")
        except Exception as e:
            logger.exception("Sync job fatal error")
            _set_job(job_id, "error", str(e))

    t = threading.Thread(target=_run, daemon=True)
    t.start()
    return jsonify({"job_id": job_id, "satellites": len(sats)})


# ─────────────────────────────────────────────────────────────────────────────
# Job status
# ─────────────────────────────────────────────────────────────────────────────

@app.route("/api/job/<job_id>")
def api_job_status(job_id):
    status = _get_job(job_id)
    if not status:
        return jsonify({"error": "job not found"}), 404
    return jsonify(status)


# ─────────────────────────────────────────────────────────────────────────────
# Auth reset
# ─────────────────────────────────────────────────────────────────────────────

@app.route("/api/reset-auth", methods=["POST"])
def api_reset_auth():
    reset_client()
    return jsonify({"reset": True})


# ─────────────────────────────────────────────────────────────────────────────
# Edges export
# ─────────────────────────────────────────────────────────────────────────────

@app.route("/api/edges")
def api_edges():
    """Return all BANKER edges across all assayed satellites."""
    sats = list_satellites()
    tier_filter = request.args.get("tier", "").upper()

    bankers = []
    for sat in sats:
        summary = sat.get("assay_summary")
        if not summary:
            continue
        # We only have the summary here — full edges require re-assay
        # This endpoint is a placeholder for Phase 2 persistent edge storage

    return jsonify({
        "note": "Full edge storage coming in Phase 2. Run assay on individual satellites for edge details.",
        "satellites_assayed": sum(1 for s in sats if s.get("last_assayed")),
    })


@app.route("/api/build-accas", methods=["POST"])
def api_build_accas():
    """Placeholder acca builder - returns top leagues by purity as legs."""
    body = request.get_json(silent=True) or {}
    use_cache = bool(body.get("use_cache", True))
    cache_only = bool(body.get("cache_only", True))
    max_sats = int(body.get("max_sats", 50))
    min_graded = int(body.get("min_graded", 5))
    max_legs = int(body.get("max_legs", 5))

    sats = list_satellites()
    sats = sats[:max_sats] if max_sats > 0 else sats

    creds = None
    if not cache_only and is_configured():
        scopes = ["https://www.googleapis.com/auth/spreadsheets.readonly",
                  "https://www.googleapis.com/auth/drive.readonly"]
        try:
            from auth.google_auth import get_service_account_credentials
            creds = get_service_account_credentials(scopes)
        except:
            pass

    league_totals = {}
    errors = []
    sats_used = 0
    from pathlib import Path

    for sat in sats:
        sheet_id = (sat.get("sheet_id") or "").strip()
        if not sheet_id:
            continue
        if cache_only and not (Path("cache/satellites") / sheet_id / "manifest.json").exists():
            continue
        try:
            rep = run_smoke_assay(sheet_id, use_cache=use_cache, credentials=creds)
            sats_used += 1
            for row in rep.get("leagues", []) or []:
                lg = (row.get("league") or "Unknown").strip() or "Unknown"
                hits = int(row.get("hits") or 0)
                graded = int(row.get("graded") or 0)
                agg = league_totals.setdefault(lg, {"league": lg, "hits": 0, "graded": 0})
                agg["hits"] += hits
                agg["graded"] += graded
        except Exception as e:
            errors.append({"sheet_id": sheet_id, "error": str(e)})

    leagues = []
    for lg, agg in league_totals.items():
        n = int(agg["graded"])
        if n < min_graded:
            continue
        h = int(agg["hits"])
        hr = (h / n) if n else 0.0
        leagues.append({
            "league": lg,
            "graded": n,
            "hits": h,
            "hit_rate": hr,
            "wilson_lower_95": hr
        })

    leagues.sort(key=lambda x: (x["wilson_lower_95"], x["graded"]), reverse=True)

    legs = [
        {
            "league": row["league"],
            "selection": None,
            "reason": f"Top league by purity (hit_rate={row["hit_rate"]:.3f}, graded={row["graded"]})"
        }
        for row in leagues[:max_legs]
    ]

    return jsonify({
        "note": "Placeholder acca builder. Next phase will select specific upcoming games/picks.",
        "legs": legs,
        "leagues_considered": len(leagues),
        "errors": errors[:50],
        "params": {
            "use_cache": use_cache,
            "cache_only": cache_only,
            "max_sats": max_sats,
            "min_graded": min_graded,
            "max_legs": max_legs
        }
    })


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5050")), debug=False)
