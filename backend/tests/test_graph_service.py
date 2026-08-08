from datetime import datetime, timedelta, timezone
import unittest

from fastapi.testclient import TestClient

from app.api.routes.graph import get_graph_service
from app.main import app
from app.models.memory import MemoryObject
from app.services.graph_service import GraphService


def memory(id, *, project=None, tags=None, relations=None, type="memory", created_at=None):
    now = created_at or datetime.now(timezone.utc)
    return MemoryObject(
        id=id,
        type=type,
        title=id,
        summary=None,
        content=None,
        project=project,
        tags=tags or [],
        relations=relations or [],
        context={"source": "test"},
        markdown_path=None,
        created_at=now,
        updated_at=now,
    )


class Metadata:
    def __init__(self, memories):
        self.memories = memories

    def list(self, **kwargs):
        return self.memories[:kwargs["limit"]]


class Vectors:
    def __init__(self, neighbours=None, error=False):
        self.neighbours = neighbours or {}
        self.error = error

    def similar(self, id, limit=3, min_score=0.72):
        if self.error:
            raise RuntimeError("vector store unavailable")
        return [
            item for item in self.neighbours.get(id, [])
            if item["score"] >= min_score
        ][:limit]


class GraphServiceTests(unittest.TestCase):
    def test_builds_sparse_edges_and_merges_shared_context(self):
        first = memory("mem_a", project="arkan", tags=["ai"], relations=["mem_b"])
        second = memory("mem_b", project="arkan", tags=["ai"])
        third = memory("mem_c", project="arkan", tags=["other"], type="idea")

        graph = GraphService(Metadata([first, second, third])).build()

        self.assertEqual(graph.stats.nodes, 3)
        self.assertEqual(graph.stats.projects, 1)
        self.assertEqual(graph.stats.types, 2)
        edge = next(item for item in graph.edges if item.source == "mem_a" and item.target == "mem_b")
        self.assertEqual(edge.kinds, ["project", "relation", "tag"])
        self.assertGreater(edge.weight, 0.9)
        self.assertTrue(all(node.degree > 0 for node in graph.nodes))

    def test_ignores_relations_outside_current_graph(self):
        graph = GraphService(Metadata([
            memory("mem_a", relations=["mem_missing"]),
        ])).build()

        self.assertEqual(graph.stats.edges, 0)
        self.assertEqual(graph.nodes[0].degree, 0)

    def test_adds_and_explains_semantic_edges(self):
        vectors = Vectors({
            "mem_a": [
                {"memory_id": "mem_b", "score": 0.84},
                {"memory_id": "mem_c", "score": 0.60},
            ],
        })
        graph = GraphService(
            Metadata([memory("mem_a"), memory("mem_b"), memory("mem_c")]),
            vectors,
        ).build(semantic_threshold=0.72)

        self.assertEqual(graph.stats.edges, 1)
        edge = graph.edges[0]
        self.assertEqual(edge.kinds, ["semantic"])
        self.assertIn("84%", edge.label)
        self.assertGreater(edge.weight, 0.4)

    def test_merges_semantic_evidence_with_explicit_relation(self):
        vectors = Vectors({
            "mem_a": [{"memory_id": "mem_b", "score": 0.90}],
        })
        graph = GraphService(
            Metadata([memory("mem_a", relations=["mem_b"]), memory("mem_b")]),
            vectors,
        ).build()

        self.assertEqual(graph.edges[0].kinds, ["relation", "semantic"])
        self.assertEqual(graph.edges[0].weight, 1.0)
        self.assertIn("semântica 90%", graph.edges[0].label)

    def test_vector_failure_does_not_break_graph(self):
        graph = GraphService(
            Metadata([memory("mem_a"), memory("mem_b")]),
            Vectors(error=True),
        ).build()

        self.assertEqual(graph.stats.nodes, 2)
        self.assertEqual(graph.stats.edges, 0)

    def test_filters_graph_by_creation_period(self):
        old = datetime.now(timezone.utc) - timedelta(days=40)
        graph = GraphService(Metadata([
            memory("mem_recent"),
            memory("mem_old", created_at=old),
        ])).build(since_days=30)

        self.assertEqual([node.id for node in graph.nodes], ["mem_recent"])


class GraphRouteTests(unittest.TestCase):
    def setUp(self):
        class FakeService:
            def build(self, **kwargs):
                return {
                    "nodes": [], "edges": [],
                    "stats": {"nodes": 0, "edges": 0, "projects": 0, "types": 0},
                }

        app.dependency_overrides[get_graph_service] = FakeService
        self.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.clear()

    def test_graph_endpoint(self):
        response = self.client.get("/api/v1/graph", params={"limit": 100})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["stats"]["nodes"], 0)


if __name__ == "__main__":
    unittest.main()
