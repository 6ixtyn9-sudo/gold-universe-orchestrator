"""
ingest — API data ingestion for the Gold Universe.

Replaces "someone copy-pastes Forebet into a Google Sheet" with a
provider-driven pipeline that emits the *same tab contract* the fleet's
sheets already produce, so brain/, assayer/ and the Mothership keep working
untouched.

    provider ─► probability sources ─► contracts ─► sinks
                                                   ├─ local bundle (offline)
                                                   └─ Supabase snapshots (live)

Entry point:  python -m ingest.cli --help
Design doc:   docs/API_MIGRATION.md
"""

from __future__ import annotations

__all__ = ["__version__"]
__version__ = "0.1.0"
