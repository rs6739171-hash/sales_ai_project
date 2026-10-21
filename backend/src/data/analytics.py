"""Business-question analytics functions, each backed by a real SQL query.

Mirrors explain_context.py's role for /forecast/explain: this module owns
computation only (rounding, percentage math, thresholding) on top of rows
already fetched via db.py -- no SQL lives here, and no LLM call happens
here either. These functions are the single source of truth used by both
the /chat tool-calling path, the deterministic /chat/quick path, and the
/kpis dashboard summary, so all three always agree with each other.
"""

from typing import Any, Optional
from . import db

DEFAULT_TREND_THRESHOLD_PCT = -10.0

def _pct_change(new:Optional[float],old:Optional[float])->Optional[float]:
    if new is None or old is None or old == 0:
        return None
    return round((new - old) / old * 100, 2)