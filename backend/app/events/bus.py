"""
events/bus.py — Synchronous in-process event bus.

MVP: Synchronous. Handlers run in the same thread, in order of subscription.

Future swap: Replace publish() internals with asyncio.Queue, Redis pub/sub,
             or a broker (RabbitMQ, NATS) without changing any caller.

Rules:
  - Handlers must not raise. Exceptions are caught and logged.
  - Handlers must be fast. Long-running work goes to a background task.
"""
import logging
from collections import defaultdict
from typing import Callable, Type

from app.events.base import BaseEvent

logger = logging.getLogger(__name__)

# Registry: event class → list of handler callables
_handlers: dict[str, list[Callable]] = defaultdict(list)


def subscribe(event_class: Type[BaseEvent], handler: Callable) -> None:
    """Register a handler for an event type."""
    _handlers[event_class.__name__].append(handler)


def publish(event: BaseEvent) -> None:
    """Dispatch an event to all registered handlers."""
    event_name = event.__class__.__name__
    for handler in _handlers.get(event_name, []):
        try:
            handler(event)
        except Exception:
            logger.exception(
                "Event handler %s failed for event %s",
                handler.__name__,
                event_name,
            )


def clear() -> None:
    """Clear all handlers. Useful for testing."""
    _handlers.clear()
