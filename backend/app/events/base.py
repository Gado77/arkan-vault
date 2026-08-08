"""
events/base.py — Base event type.

All events inherit from BaseEvent.
Dataclass keeps it lightweight — no external deps.
"""
from dataclasses import dataclass, field
from datetime import datetime, timezone


def _now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class BaseEvent:
    """Every event carries a timestamp. Nothing else required."""
    occurred_at: datetime = field(default_factory=_now)
