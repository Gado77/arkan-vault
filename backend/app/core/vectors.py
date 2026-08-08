"""Stateless vector scoring primitives."""


def distance_to_score(distance: float | None) -> float:
    """Convert a non-negative vector distance into a [0, 1] relevance score."""
    if distance is None:
        return 0.0
    normalized_distance = max(float(distance), 0.0)
    return round(1.0 / (1.0 + normalized_distance), 6)
