"""
config_loader.py — Loads config.json for a given project directory.
Pass project_dir to load a specific project's config; omits the arg to
fall back to the directory containing this file (legacy behaviour).
"""

import json
import sys
from pathlib import Path


def load_config(project_dir=None) -> dict:
    if project_dir is not None:
        config_path = Path(project_dir) / "config.json"
    else:
        config_path = Path(__file__).parent / "config.json"

    if not config_path.exists():
        print(
            "ERROR: config.json not found.\n"
            "Open the BD Agent tool in the UI and complete onboarding first.\n"
            f"(Expected at: {config_path})"
        )
        sys.exit(1)

    with open(config_path, encoding="utf-8") as f:
        return json.load(f)
