# core/ — Infrastructure Primitives
#
# These are reusable, stateless components with no business logic.
# They can be used by services/, storage/, and future modules (Hermes, etc.).
#
# Rules:
#   - No imports from app.services or app.storage
#   - No knowledge of KnowledgeObject
#   - Pure functions or thin wrappers around external libs
