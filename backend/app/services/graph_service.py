"""Build a sparse graph from MemoryObject relationships and shared context."""
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from app.schemas.graph import GraphEdge, GraphNode, GraphResponse, GraphStats
from app.storage.metadata_storage import MetadataStorageBase
from app.storage.vector_storage import VectorStorageBase


class GraphService:
    def __init__(self, metadata: MetadataStorageBase, vector: VectorStorageBase | None = None):
        self.metadata = metadata
        self.vector = vector

    def build(
        self,
        *,
        type: str | None = None,
        project: str | None = None,
        tags: list[str] | None = None,
        limit: int = 500,
        include_semantic: bool = True,
        semantic_threshold: float = 0.53,
        semantic_neighbors: int = 3,
        since_days: int | None = None,
    ) -> GraphResponse:
        memories = self.metadata.list(
            type=type,
            project=project,
            tags=tags,
            limit=limit,
            offset=0,
        )
        if since_days is not None:
            cutoff = datetime.now(timezone.utc) - timedelta(days=since_days)
            memories = [memory for memory in memories if self._as_utc(memory.created_at) >= cutoff]
        by_id = {memory.id: memory for memory in memories}
        edges: dict[tuple[str, str], dict] = {}

        def connect(source: str, target: str, kind: str, weight: float, label=None):
            if source == target or source not in by_id or target not in by_id:
                return
            left, right = sorted((source, target))
            key = (left, right)
            if key not in edges:
                edges[key] = {
                    "source": left,
                    "target": right,
                    "kinds": [],
                    "weight": 0.0,
                    "labels": [],
                }
            edge = edges[key]
            if kind not in edge["kinds"]:
                edge["kinds"].append(kind)
                edge["weight"] = min(edge["weight"] + weight, 1.0)
            if label and label not in edge["labels"]:
                edge["labels"].append(label)

        for memory in memories:
            for related_id in memory.relations:
                connect(memory.id, related_id, "relation", 0.70, "relação")

        projects = defaultdict(list)
        tags_index = defaultdict(list)
        for memory in memories:
            if memory.project:
                projects[memory.project].append(memory.id)
            for tag in memory.tags:
                tags_index[tag].append(memory.id)

        for project_name, ids in projects.items():
            self._connect_group(ids, lambda a, b: connect(
                a, b, "project", 0.30, project_name
            ))

        for tag, ids in tags_index.items():
            self._connect_group(ids, lambda a, b: connect(
                a, b, "tag", 0.18, f"#{tag}"
            ))

        if include_semantic and self.vector:
            for memory in memories:
                try:
                    neighbours = self.vector.similar(
                        memory.id,
                        limit=semantic_neighbors,
                        min_score=semantic_threshold,
                    )
                except Exception:
                    # A missing/corrupt vector must not make the memory graph unavailable.
                    continue
                for neighbour in neighbours:
                    score = float(neighbour["score"])
                    connect(
                        memory.id,
                        neighbour["memory_id"],
                        "semantic",
                        min(0.55, score * 0.55),
                        f"semântica {score:.0%}",
                    )

        degree = defaultdict(int)
        graph_edges = []
        for (source, target), edge in edges.items():
            degree[source] += 1
            degree[target] += 1
            graph_edges.append(GraphEdge(
                id=f"edge:{source}:{target}",
                source=source,
                target=target,
                kinds=sorted(edge["kinds"]),
                weight=round(edge["weight"], 3),
                label=" · ".join(edge["labels"][:4]) or None,
            ))

        nodes = [GraphNode(
            id=memory.id,
            type=memory.type,
            title=memory.title,
            summary=memory.summary,
            project=memory.project,
            tags=memory.tags,
            degree=degree[memory.id],
            size=round(1.0 + min(degree[memory.id], 12) * 0.12, 2),
            created_at=memory.created_at,
            updated_at=memory.updated_at,
        ) for memory in memories]

        return GraphResponse(
            nodes=nodes,
            edges=graph_edges,
            stats=GraphStats(
                nodes=len(nodes),
                edges=len(graph_edges),
                projects=len(projects),
                types=len({memory.type for memory in memories}),
            ),
        )

    @staticmethod
    def _connect_group(ids: list[str], connect) -> None:
        ordered = sorted(set(ids))
        if len(ordered) < 2:
            return
        for index in range(len(ordered) - 1):
            connect(ordered[index], ordered[index + 1])
        if len(ordered) > 2:
            connect(ordered[-1], ordered[0])

    @staticmethod
    def _as_utc(value: datetime) -> datetime:
        return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
