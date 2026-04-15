import math
import logging
from collections import defaultdict

logger = logging.getLogger(__name__)

# Grading thresholds (win rate based)
GRADES = [
    ("PLATINUM", 0.80),
    ("GOLD",     0.70),
    ("SILVER",   0.60),
    ("BRONZE",   0.55),
    ("CHARCOAL", 0.50),
    ("DUST",     0.00),
]

WILSON_Z = 1.645       # 80% one-sided confidence interval
MIN_N = 10             # Minimum samples to appear in output
MIN_N_RELIABLE = 30    # Minimum samples for "reliable" flag
MIN_LIFT = 0.03        # Minimum |win_rate - 0.50| to qualify as an edge


def wilson_lower_bound(wins, n, z=WILSON_Z):
    """Wilson score lower bound — conservative win-rate estimate."""
    if n == 0:
        return 0.0
    p = wins / n
    denom = 1 + (z * z / n)
    center = p + (z * z) / (2 * n)
    spread = z * math.sqrt((p * (1 - p) / n) + (z * z / (4 * n * n)))
    return max(0.0, (center - spread) / denom)


def shrink_rate(wins, n, prior_alpha=2, prior_beta=2):
    """Bayesian shrinkage toward 50% using Beta prior."""
    return (wins + prior_alpha) / (n + prior_alpha + prior_beta)


def assign_grade(win_rate):
    """Assign letter grade based on win rate."""
    for grade, threshold in GRADES:
        if win_rate >= threshold:
            return grade
    return "DUST"


def classify_tier(win_rate, lower_bound, n):
    """
    Classify an edge as BANKER / ROBBER / NEUTRAL.

    BANKER  = high confidence, strong win rate
    ROBBER  = use as fade (below coinflip) or too few samples
    NEUTRAL = positive but uncertain
    """
    if n < MIN_N:
        return "ROBBER"
    if win_rate < 0.50:
        return "ROBBER"
    if lower_bound >= 0.60 and win_rate >= 0.72:
        return "BANKER"
    if lower_bound >= 0.55 and win_rate >= 0.62:
        return "BANKER"
    return "NEUTRAL"


def _normalise(val):
    if val is None:
        return ""
    return str(val).strip().lower()


def _parse_outcome(val):
    v = _normalise(val)
    if v in ("win", "w", "1", "yes", "correct", "hit", "true"):
        return "win"
    if v in ("loss", "l", "0", "no", "wrong", "miss", "false"):
        return "loss"
    return None


def _parse_float(val):
    try:
        s = str(val).replace("%", "").strip()
        return float(s)
    except (ValueError, TypeError):
        return None


def _conf_bucket(conf):
    """Group confidence into buckets for segmentation."""
    if conf is None:
        return "unknown"
    try:
        c = float(str(conf).replace("%", ""))
        if c >= 80:
            return "high"
        if c >= 60:
            return "medium"
        return "low"
    except (ValueError, TypeError):
        return "unknown"


def assay_side_data(side_rows, source_label="Side"):
    """
    Process Side sheet rows into edge segments.
    Each segment is keyed by (league, quarter, tier, side, conf_bucket, source).
    """
    segments = defaultdict(lambda: {"wins": 0, "losses": 0})

    for row in side_rows:
        outcome = _parse_outcome(
            row.get("outcome") or row.get("result") or
            row.get("Outcome") or row.get("Result") or ""
        )
        if outcome is None:
            continue

        league = _normalise(row.get("league") or row.get("League") or "unknown")
        quarter = _normalise(row.get("quarter") or row.get("Quarter") or "all")
        tier = _normalise(row.get("tier") or row.get("Tier") or "unknown")
        side = _normalise(row.get("side") or row.get("Side") or
                          row.get("pick") or row.get("Pick") or "unknown")

        conf_raw = _parse_float(
            row.get("confidence") or row.get("Confidence") or
            row.get("Confidence_Pct") or 0
        )
        conf_bucket = _conf_bucket(conf_raw)

        key = (league, quarter, tier, side, conf_bucket, source_label)
        if outcome == "win":
            segments[key]["wins"] += 1
        else:
            segments[key]["losses"] += 1

    return _build_edges(segments)


def assay_totals_data(totals_rows, source_label="Totals"):
    """
    Process Totals sheet rows into edge segments.
    Each segment keyed by (league, quarter, direction, bet_type, conf_bucket, source).
    """
    segments = defaultdict(lambda: {"wins": 0, "losses": 0})

    for row in totals_rows:
        outcome = _parse_outcome(
            row.get("result") or row.get("Result") or
            row.get("outcome") or row.get("Outcome") or ""
        )
        if outcome is None:
            continue

        league = _normalise(row.get("league") or row.get("League") or "unknown")
        quarter = _normalise(row.get("quarter") or row.get("Quarter") or "all")
        direction = _normalise(row.get("direction") or row.get("Direction") or "unknown")
        bet_type = _normalise(row.get("type") or row.get("Type") or "ou")

        conf_raw = _parse_float(
            row.get("confidence") or row.get("Confidence") or 0
        )
        conf_bucket = _conf_bucket(conf_raw)

        key = (league, quarter, direction, bet_type, conf_bucket, source_label)
        if outcome == "win":
            segments[key]["wins"] += 1
        else:
            segments[key]["losses"] += 1

    return _build_edges(segments)


def _build_edges(segments):
    """Convert segment win/loss counts into edge dicts."""
    edges = []

    for key, counts in segments.items():
        wins = counts["wins"]
        losses = counts["losses"]
        n = wins + losses

        if n < MIN_N:
            continue

        win_rate = wins / n
        lift = win_rate - 0.50

        if abs(lift) < MIN_LIFT:
            continue

        shrunk = shrink_rate(wins, n)
        lb = wilson_lower_bound(wins, n)
        grade = assign_grade(win_rate)
        tier = classify_tier(win_rate, lb, n)
        reliable = n >= MIN_N_RELIABLE and lb > 0

        edge = {
            "segment": key,
            "wins": wins,
            "losses": losses,
            "n": n,
            "win_rate": round(win_rate, 4),
            "shrunk_rate": round(shrunk, 4),
            "wilson_lb": round(lb, 4),
            "lift": round(lift, 4),
            "grade": grade,
            "tier": tier,
            "reliable": reliable,
            "source": key[-1] if key else "unknown",
        }
        edges.append(edge)

    edges.sort(key=lambda e: e["wilson_lb"], reverse=True)
    return edges


def compute_league_purity(edges):
    """Compute per-league purity summary from edges."""
    by_league = defaultdict(lambda: {"wins": 0, "n": 0, "grades": defaultdict(int)})

    for edge in edges:
        seg = edge.get("segment", ())
        league = seg[0] if seg else "unknown"
        by_league[league]["wins"] += edge["wins"]
        by_league[league]["n"] += edge["n"]
        by_league[league]["grades"][edge["grade"]] += 1

    purity = []
    for league, stats in by_league.items():
        n = stats["n"]
        wins = stats["wins"]
        if n == 0:
            continue

        wr = wins / n
        lb = wilson_lower_bound(wins, n)
        grade = assign_grade(wr)

        purity.append({
            "league": league,
            "n": n,
            "win_rate": round(wr, 4),
            "wilson_lb": round(lb, 4),
            "grade": grade,
            "grade_breakdown": dict(stats["grades"]),
        })

    purity.sort(key=lambda p: p["wilson_lb"], reverse=True)
    return purity


def run_full_assay(satellite_payload):
    """
    Run a complete assay on a fetched satellite payload.

    Returns:
    {
      "edges": [...],
      "league_purity": [...],
      "summary": {
        "total_edges": int,
        "banker_count": int,
        "robber_count": int,
        "neutral_count": int,
        "gold_count": int,
        "gold_pct": float,
        "overall_win_rate": float | None,
        "grade_breakdown": {...},
      }
    }
    """
    data = satellite_payload.get("data", {})
    side_rows = data.get("side", [])
    totals_rows = data.get("totals", [])

    side_edges = assay_side_data(side_rows, source_label="Side")
    totals_edges = assay_totals_data(totals_rows, source_label="Totals")
    all_edges = side_edges + totals_edges

    league_purity = compute_league_purity(all_edges)

    bankers = [e for e in all_edges if e["tier"] == "BANKER"]
    robbers = [e for e in all_edges if e["tier"] == "ROBBER"]
    neutrals = [e for e in all_edges if e["tier"] == "NEUTRAL"]

    gold_count = sum(1 for e in all_edges if e["grade"] in ("GOLD", "PLATINUM"))
    total_edges = len(all_edges)

    grade_breakdown = defaultdict(int)
    for e in all_edges:
        grade_breakdown[e["grade"]] += 1

    # Overall win rate from all segments
    total_wins = sum(e["wins"] for e in all_edges)
    total_n = sum(e["n"] for e in all_edges)
    overall_wr = (total_wins / total_n) if total_n > 0 else None

    summary = {
        "total_edges": total_edges,
        "banker_count": len(bankers),
        "robber_count": len(robbers),
        "neutral_count": len(neutrals),
        "gold_count": gold_count,
        "gold_pct": round(gold_count / total_edges, 4) if total_edges > 0 else 0.0,
        "overall_win_rate": round(overall_wr, 4) if overall_wr is not None else None,
        "grade_breakdown": dict(grade_breakdown),
    }

    return {
        "edges": all_edges,
        "league_purity": league_purity,
        "summary": summary,
    }
