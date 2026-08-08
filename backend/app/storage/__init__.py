"""
storage/ — Persistence interfaces.

Each storage module defines an abstract interface + a default implementation.
To swap backends (e.g. SQLite → Postgres), create a new implementation
that satisfies the same interface and update the dependency in services/.

Rule: storage modules may use core/ primitives, never services/.
"""
