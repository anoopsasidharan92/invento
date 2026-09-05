"""
Loads config.json for a given project directory (same as BD agent).
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
            "Open the Sales Deal Agent tool in the UI and complete onboarding first.\n"
            f"(Expected at: {config_path})"
        )
        sys.exit(1)

    with open(config_path, encoding="utf-8") as f:
        return json.load(f)
