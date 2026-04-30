from pathlib import Path
import sys

REPO_ROOT   = Path(__file__).resolve().parent.parent
TARGET      = REPO_ROOT / "Ma_Golide_Satellites" / "docs" / "Margin_Analyzer.gs"

# ── Each entry defines the SECOND (duplicate) copy by its unique opening line.
# We find that line, then scan forward to the matching closing brace,
# and delete the entire block including its preceding JSDoc comment.
# ─────────────────────────────────────────────────────────────────────────────
# Format: (unique_line_in_second_copy, description)
SECOND_COPY_ANCHORS = [
    (
        # _t1fDetermineBlame — second copy uses "contributions" object pattern
        "const contributions = {",
        "_t1fDetermineBlame (second copy — contributions pattern)"
    ),
    (
        # _t1fBuildResultsMap — second copy has "order-independent" in function body
        "Generate team key (order-independent)",
        "_t1fBuildResultsMap (second copy — order-independent comment)"
    ),
    (
        # _t1fGenerateMatchKey — second copy has teams.sort()
        "const teams = [String(home",
        "_t1fGenerateMatchKey (second copy — teams.sort pattern)"
    ),
    (
        # _t1fFormatDate — second copy handles Google Sheets serial numbers
        "else if (typeof dateVal === 'number') {",
        "_t1fFormatDate (second copy — serial number handler)"
    ),
    (
        # simulateTier1Configs — second copy is the empty stub
        "// [Z.AI'S FULL IMPLEMENTATION - CONDITIONALLY APPROVED]",
        "simulateTier1Configs (second copy — empty stub)"
    ),
]


def find_block_to_remove(lines: list[str], anchor: str) -> tuple[int, int] | None:
    """
    Find the JSDoc comment + function block containing `anchor`.
    Returns (start_line_idx, end_line_idx) inclusive, or None.

    Strategy:
    1. Find the line containing the anchor text
    2. Walk BACKWARDS to find the start of the preceding /** comment or
       the function keyword if no JSDoc
    3. Walk FORWARDS counting braces to find the closing }
    """
    # Step 1: find anchor line
    anchor_idx = None
    for i, line in enumerate(lines):
        if anchor in line:
            anchor_idx = i
            break

    if anchor_idx is None:
        return None

    # Step 2: walk backwards to find block start
    # Go back to find the function keyword line, then keep going for JSDoc
    block_start = anchor_idx
    for i in range(anchor_idx, max(0, anchor_idx - 60), -1):
        stripped = lines[i].strip()
        if stripped.startswith("function ") or stripped.startswith("/**"):
            block_start = i
            if stripped.startswith("/**"):
                break  # found JSDoc start
            # if we found function keyword, keep going back for JSDoc
            for j in range(i - 1, max(0, i - 30), -1):
                s = lines[j].strip()
                if s.startswith("/**"):
                    block_start = j
                    break
                elif s == "" or (not s.startswith("*") and not s.startswith("/*")):
                    break
            break

    # Step 3: walk forward from anchor to find the closing brace
    # Count braces starting from the function line
    func_line = None
    for i in range(block_start, min(len(lines), anchor_idx + 5)):
        if lines[i].strip().startswith("function "):
            func_line = i
            break

    if func_line is None:
        return None

    depth = 0
    block_end = None
    for i in range(func_line, len(lines)):
        # Rough brace counting (good enough for clean GAS code)
        depth += lines[i].count("{") - lines[i].count("}")
        if depth == 0 and i > func_line:
            block_end = i
            break

    if block_end is None:
        return None

    return block_start, block_end


def main():
    if not TARGET.exists():
        print(f"ERROR: File not found: {TARGET}")
        sys.exit(1)

    print(f"Reading: {TARGET}")
    source = TARGET.read_text(encoding="utf-8")
    lines  = source.splitlines(keepends=True)
    original_count = len(lines)
    print(f"Lines: {original_count:,}   Characters: {len(source):,}")

    # Safety check — file must be substantial
    if len(source) < 100_000:
        print("ERROR: File looks too small — something is already wrong. Aborting.")
        sys.exit(1)

    removed_blocks = []

    # Process anchors in REVERSE order so line numbers stay valid
    # (removing a later block doesn't shift earlier line numbers)
    anchors_with_ranges = []
    for anchor, description in SECOND_COPY_ANCHORS:
        result = find_block_to_remove(lines, anchor)
        if result is None:
            print(f"  SKIP (not found): {description}")
            continue
        start, end = result
        anchors_with_ranges.append((start, end, description))
        print(f"  Found: {description}  → lines {start+1}–{end+1}")

    # Sort by start line descending so we remove from bottom up
    anchors_with_ranges.sort(key=lambda x: x[0], reverse=True)

    for start, end, description in anchors_with_ranges:
        # Eat one blank line before the block if present
        actual_start = start
        if start > 0 and lines[start - 1].strip() == "":
            actual_start = start - 1

        del lines[actual_start : end + 1]
        removed_blocks.append(description)
        print(f"  ✅ Removed: {description}")

    # Write result
    new_source = "".join(lines)
    new_count  = len(lines)
    removed_lines = original_count - new_count

    # Safety: refuse to write if we removed more than 15% of lines
    if removed_lines > original_count * 0.15:
        print(f"\nSAFETY ABORT: Would remove {removed_lines} lines ({removed_lines/original_count:.1%}).")
        print("That's more than 15% — something went wrong. File NOT modified.")
        sys.exit(1)

    TARGET.write_text(new_source, encoding="utf-8")

    print(f"\n✅ Done.")
    print(f"   Blocks removed: {len(removed_blocks)}")
    print(f"   Lines removed:  {removed_lines:,}")
    print(f"   New size:       {len(new_source):,} characters")
    print(f"\nTest deploy on 1 satellite:")
    print(f"  cd ~/Desktop/gold-universe-orchestrator")
    print(f"  python3 scripts/deploy_gs_to_satellites.py --limit 1")


if __name__ == "__main__":
    main()
