"""Test import boundary for the standalone Obsidian adapter artifacts."""

from __future__ import annotations

import sys
from pathlib import Path

ADAPTER_ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(ADAPTER_ROOT))
