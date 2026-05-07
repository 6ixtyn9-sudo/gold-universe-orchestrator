"""
brain — Centralized Python engine replacing all .gs satellite logic.
Reads from Supabase snapshots, processes, writes results back to Supabase
and optionally pushes to Google Sheets for UX display.
"""

BRAIN_VERSION = "1.0.0"
