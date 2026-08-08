"""
events/ — In-process event system.

Every significant action in the system publishes an event.
Consumers (plugins, future Hermes, etc.) subscribe to events
without coupling to the source module.

MVP: Synchronous, in-process.
Future: Swap bus.py for an async/Redis/broker implementation
        without changing any event definition or publisher.

Usage:
    from app.events import bus
    from app.events.memory_events import MemoryCreated

    # Subscribe
    bus.subscribe(MemoryCreated, my_handler)

    # Publish
    bus.publish(MemoryCreated(memory_id="mem_abc123", type="idea"))
"""
