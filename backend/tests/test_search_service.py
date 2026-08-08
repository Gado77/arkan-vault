from datetime import datetime, timezone
import unittest

from app.events import bus
from app.events.memory_events import SearchExecuted
from app.models.memory import MemoryObject
from app.services import search_service


def memory(
    id: str,
    type: str = "memory",
    project: str | None = "arkan",
    tags: list[str] | None = None,
) -> MemoryObject:
    now = datetime.now(timezone.utc)
    return MemoryObject(
        id=id,
        type=type,
        title=id,
        summary=None,
        content="content",
        project=project,
        tags=tags or [],
        relations=[],
        context={"source": "test"},
        markdown_path=None,
        created_at=now,
        updated_at=now,
    )


class FakeMetadataStorage:
    def __init__(self, objects):
        self.objects = {obj.id: obj for obj in objects}

    def get(self, id):
        return self.objects.get(id)

    def list(self, type=None, project=None, tags=None, limit=50, offset=0):
        required_tags = set(tags or [])
        results = [
            obj for obj in self.objects.values()
            if (not type or obj.type == type)
            and (not project or obj.project == project)
            and (not required_tags or required_tags.issubset(set(obj.tags)))
        ]
        return results[offset:offset + limit]


class FakeVectorStorage:
    def __init__(self, results):
        self.results = results
        self.calls = []

    def search(self, embedding, limit=10, filters=None):
        self.calls.append((embedding, limit, filters))
        return self.results


class SearchServiceTests(unittest.TestCase):
    def setUp(self):
        bus.clear()
        self.events = []
        bus.subscribe(SearchExecuted, self.events.append)
        self.original_embed = search_service.embeddings.embed
        search_service.embeddings.embed = lambda query: [0.1, 0.2]

    def tearDown(self):
        search_service.embeddings.embed = self.original_embed
        bus.clear()

    def test_search_returns_full_objects_and_publishes_event(self):
        obj = memory("mem_one")
        vector = FakeVectorStorage([{"memory_id": obj.id, "score": 0.91}])
        service = search_service.SearchService(FakeMetadataStorage([obj]), vector)

        results = service.search("persistent memory", limit=3, mode="semantic")

        self.assertEqual([result.memory_id for result in results], [obj.id])
        self.assertEqual(results[0].score, 0.91)
        self.assertEqual(vector.calls, [([0.1, 0.2], 3, None)])
        self.assertEqual(self.events[0].result_count, 1)
        self.assertEqual(self.events[0].search_type, "semantic")

    def test_filters_type_project_and_normalized_tags(self):
        accepted = memory(
            "mem_accepted",
            type="idea",
            project="arkan",
            tags=["machine-learning", "stage-3"],
        )
        rejected = memory(
            "mem_rejected",
            type="idea",
            project="arkan",
            tags=["stage-3"],
        )
        vector = FakeVectorStorage([
            {"memory_id": rejected.id, "score": 0.95},
            {"memory_id": accepted.id, "score": 0.90},
        ])
        service = search_service.SearchService(
            FakeMetadataStorage([accepted, rejected]),
            vector,
        )

        results = service.search(
            "learning",
            limit=2,
            type="idea",
            project="arkan",
            tags=["Machine Learning"],
            mode="semantic",
        )

        self.assertEqual([result.memory_id for result in results], [accepted.id])
        self.assertEqual(vector.calls[0][1], 50)
        self.assertEqual(vector.calls[0][2], {
            "$and": [{"type": "idea"}, {"project": "arkan"}],
        })

    def test_orphaned_vectors_are_ignored(self):
        vector = FakeVectorStorage([{"memory_id": "mem_missing", "score": 0.8}])
        service = search_service.SearchService(FakeMetadataStorage([]), vector)

        results = service.search("missing", mode="semantic")

        self.assertEqual(results, [])
        self.assertEqual(self.events[0].result_count, 0)

    def test_text_mode_does_not_generate_embedding(self):
        obj = memory("mem_text", tags=["memoria-persistente"])
        obj.title = "Memória Persistente"
        vector = FakeVectorStorage([])
        service = search_service.SearchService(FakeMetadataStorage([obj]), vector)
        search_service.embeddings.embed = lambda query: self.fail("embedding called")

        results = service.search("memoria persistente", mode="text")

        self.assertEqual([result.memory_id for result in results], [obj.id])
        self.assertEqual(results[0].score, 1.0)
        self.assertEqual(results[0].score_breakdown.semantic, 0.0)
        self.assertEqual(results[0].score_breakdown.text, 1.0)
        self.assertEqual(vector.calls, [])
        self.assertEqual(self.events[0].search_type, "text")

    def test_hybrid_unions_candidates_and_rewards_agreement(self):
        both = memory("mem_both")
        both.title = "Semantic memory"
        semantic_only = memory("mem_semantic")
        semantic_only.title = "Unrelated title"
        text_only = memory("mem_text")
        text_only.title = "Semantic memory"
        vector = FakeVectorStorage([
            {"memory_id": semantic_only.id, "score": 0.80},
            {"memory_id": both.id, "score": 0.80},
        ])
        service = search_service.SearchService(
            FakeMetadataStorage([both, semantic_only, text_only]),
            vector,
        )

        results = service.search("semantic memory", limit=3, mode="hybrid")

        self.assertEqual(
            [result.memory_id for result in results],
            [both.id, text_only.id, semantic_only.id],
        )
        self.assertEqual(results[0].score, 1.0)
        self.assertGreater(results[0].score_breakdown.agreement_bonus, 0.0)
        self.assertEqual(results[1].score_breakdown.semantic, 0.0)
        self.assertEqual(results[2].score_breakdown.text, 0.0)
        self.assertEqual(self.events[0].search_type, "hybrid")


if __name__ == "__main__":
    unittest.main()
