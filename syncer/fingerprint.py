import hashlib
import json

def compute_fingerprint(files: list) -> str:
    """
    Computes a deterministic SHA256 fingerprint for a list of module files.
    - Sorts files by name.
    - Normalizes line endings (\r\n -> \n).
    - Ignores appsscript manifest formatting quirks if needed, but here we just hash the source.
    """
    # Sort files by name to ensure consistent order
    sorted_files = sorted(files, key=lambda x: x["name"])
    
    overall_hash = hashlib.sha256()
    
    for f in sorted_files:
        name = f["name"]
        source = f.get("source", "")
        # Normalize line endings
        source = source.replace("\r\n", "\n")
        
        file_hash = hashlib.sha256(source.encode("utf-8")).hexdigest()
        overall_hash.update(f"{name}:{file_hash}\n".encode("utf-8"))
        
    return overall_hash.hexdigest()
