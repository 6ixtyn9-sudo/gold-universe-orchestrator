import re
import sys
from pathlib import Path

REPO_ROOT   = Path(__file__).resolve().parent.parent
TARGET_FILE = REPO_ROOT / "Ma_Golide_Satellites" / "docs" / "Margin_Analyzer.gs"


def extract_function_body(source: str, start_idx: int) -> tuple[int, int]:
    """
    Given the index of the opening '{' of a function body, find the matching '}'.
    Returns (open_brace_idx, close_brace_idx) inclusive.
    Skips braces in strings and comments.
    """
    depth = 0
    i = start_idx
    in_string = None  # None, '"', "'", or "`"
    in_comment = None  # None, 'single', 'multi'

    while i < len(source):
        c = source[i]
        next_c = source[i+1] if i + 1 < len(source) else ""

        # Handle strings
        if not in_comment:
            if in_string:
                if c == in_string and source[i-1] != '\\':
                    in_string = None
            elif c in ('"', "'", '`'):
                in_string = c

        if in_string:
            i += 1
            continue

        # Handle comments
        if in_comment == 'single':
            if c == '\n':
                in_comment = None
        elif in_comment == 'multi':
            if c == '*' and next_c == '/':
                in_comment = None
                i += 1
        else:
            if c == '/' and next_c == '/':
                in_comment = 'single'
                i += 1
            elif c == '/' and next_c == '*':
                in_comment = 'multi'
                i += 1

        if in_comment:
            i += 1
            continue

        # Handle braces
        if c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0:
                return start_idx, i
        i += 1

    print(f"  WARNING: Could not find matching brace starting at index {start_idx} (depth={depth})")
    return start_idx, len(source) - 1


def find_function_spans(source: str, fn_name: str) -> list[tuple[int, int]]:
    """
    Find all occurrences of a top-level function declaration and return
    (start, end) character spans for each complete declaration.
    """
    pattern = re.compile(
        r'(/\*\*.*?\*/\s*)?'          # optional JSDoc
        r'function\s+' + re.escape(fn_name) + r'\s*\(',
        re.DOTALL
    )

    spans = []
    for m in pattern.finditer(source):
        fn_start = m.start()

        # Find the opening brace of the function body
        brace_pos = source.find('{', m.end())
        if brace_pos == -1:
            continue

        _, body_end = extract_function_body(source, brace_pos)
        
        # Safety: if body_end is end of file, and we have multiple functions,
        # we might be nuking. Let's log it.
        if body_end == len(source) - 1:
            print(f"  CRITICAL: Function '{fn_name}' at {fn_start} seems to run to EOF.")

        spans.append((fn_start, body_end))

    return spans


def remove_duplicate_functions(source: str, fn_names: list[str],
                                keep: str = 'first') -> tuple[str, list[str]]:
    """
    For each function name, keep only one occurrence (first or last),
    remove all others.  Returns (cleaned_source, list_of_removed_names).
    """
    removed = []

    for fn_name in fn_names:
        spans = find_function_spans(source, fn_name)

        if len(spans) <= 1:
            continue  # not duplicated

        print(f"  Found {len(spans)} declarations of '{fn_name}' — keeping {keep}")
        removed.append(fn_name)

        if keep == 'first':
            # Remove everything AFTER the first occurrence (in reverse order)
            to_remove = spans[1:]
        else:  # keep == 'last'
            to_remove = spans[:-1]

        # Remove in reverse order so earlier indices stay valid
        for (start, end) in reversed(to_remove):
            if end == len(source) - 1:
                print(f"  SKIPPING REMOVAL of '{fn_name}' span because it reaches EOF (safety).")
                continue
                
            # Also eat any leading whitespace/newlines before the removed block
            pre = source.rfind('\n', 0, start)
            remove_from = pre + 1 if pre != -1 else start
            source = source[:remove_from] + source[end + 1:]

    return source, removed


def fix_simulateTier1Configs(source: str) -> str:
    """
    Special case: simulateTier1Configs is declared twice.
    """
    spans = find_function_spans(source, 'simulateTier1Configs')
    if len(spans) <= 1:
        return source

    # Identify which one is the old hard-coded version
    old_idx = None
    for i, (start, end) in enumerate(spans):
        snippet = source[start:end]
        if 'const sampleConfigs' in snippet or (
            '// [Z.AI' in snippet and len(snippet) < 200
        ):
            old_idx = i
            break

    if old_idx is None:
        old_idx = 0

    start, end = spans[old_idx]
    if end == len(source) - 1:
         print(f"  SKIPPING REMOVAL of 'simulateTier1Configs' because it reaches EOF.")
         return source
         
    pre = source.rfind('\n', 0, start)
    remove_from = pre + 1 if pre != -1 else start
    source = source[:remove_from] + source[end + 1:]
    print(f"  Removed duplicate 'simulateTier1Configs' (kept the grid-based version)")

    return source


def main():
    if not TARGET_FILE.exists():
        print(f"ERROR: File not found: {TARGET_FILE}")
        sys.exit(1)

    print(f"Reading: {TARGET_FILE}")
    source = TARGET_FILE.read_text(encoding='utf-8')
    original_len = len(source)
    print(f"File size: {original_len:,} characters")

    # ── Deduplicate these functions (keep FIRST occurrence) ─────────────────
    KEEP_FIRST = [
        '_t1fDetermineBlame',
        '_t1fBuildResultsMap',
        '_t1fGenerateMatchKey',
        '_t1fFormatDate',
        'simulateTier1Configs_',
    ]

    print("\nDeduplicating functions...")
    source, removed = remove_duplicate_functions(source, KEEP_FIRST, keep='first')

    # ── Special case: simulateTier1Configs (no underscore) ──────────────────
    source = fix_simulateTier1Configs(source)

    # ── Write fixed file ─────────────────────────────────────────────────────
    TARGET_FILE.write_text(source, encoding='utf-8')
    new_len = len(source)
    removed_chars = original_len - new_len

    print(f"\n✅ Done.")
    print(f"   Functions deduplicated: {removed}")
    print(f"   Characters removed: {removed_chars:,}")
    print(f"   New file size: {new_len:,} characters")


if __name__ == '__main__':
    main()
