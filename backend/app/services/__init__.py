"""
services/ — Business Logic (Orchestration Layer)

Services orchestrate storage/ and core/ to fulfill use cases.
They do NOT touch databases directly — that belongs to storage/.
They do NOT generate embeddings directly — that belongs to core/.

Rule: services may import from core/ and storage/, never from api/.
"""
