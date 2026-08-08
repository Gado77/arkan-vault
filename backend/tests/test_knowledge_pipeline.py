import importlib
import sys
import types
import unittest


class KnowledgePipelineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        config = types.ModuleType("app.config")
        config.settings = types.SimpleNamespace(
            CHROMA_PATH="unused-in-unit-test",
            MEMORIES_PATH="unused-in-unit-test",
            EMBEDDING_MODEL="test-model",
        )
        sys.modules["app.config"] = config

        cls.pipeline = importlib.import_module("app.workers.knowledge_pipeline")
        cls.bus = importlib.import_module("app.events.bus")
        events = importlib.import_module("app.events.memory_events")
        cls.MemoryCreated = events.MemoryCreated
        cls.MemoryDeleted = events.MemoryDeleted
        cls.MemoryUpdated = events.MemoryUpdated
        cls.EmbeddingGenerated = events.EmbeddingGenerated

    def setUp(self):
        self.bus.clear()
        self.pipeline._started = False

        self.original_vector_storage = self.pipeline.ChromaVectorStorage
        self.original_markdown_storage = self.pipeline.FilesystemMarkdownStorage
        self.original_embed = self.pipeline.embeddings.embed

        self.saved_vectors = []
        self.deleted_vectors = []
        self.embedding_events = []
        self.markdown_content = "A durable memory about semantic search."

        test = self

        class FakeVectorStorage:
            def save(self, id, embedding, metadata):
                test.saved_vectors.append((id, embedding, metadata))

            def delete(self, id):
                test.deleted_vectors.append(id)
                return True

        class FakeMarkdownStorage:
            def __init__(self, _base_path):
                pass

            def get(self, _id):
                return test.markdown_content

        self.pipeline.ChromaVectorStorage = FakeVectorStorage
        self.pipeline.FilesystemMarkdownStorage = FakeMarkdownStorage
        self.pipeline.embeddings.embed = lambda text: [float(len(text)), 1.0]
        self.bus.subscribe(
            self.EmbeddingGenerated,
            self.embedding_events.append,
        )

    def tearDown(self):
        self.pipeline.ChromaVectorStorage = self.original_vector_storage
        self.pipeline.FilesystemMarkdownStorage = self.original_markdown_storage
        self.pipeline.embeddings.embed = self.original_embed
        self.pipeline._started = False
        self.bus.clear()

    def test_memory_created_generates_and_saves_embedding(self):
        self.pipeline.start_knowledge_pipeline()
        self.bus.publish(self.MemoryCreated(
            memory_id="mem_test",
            type="idea",
            project="arkan",
            tags=["semantic-search"],
        ))

        self.assertEqual(len(self.saved_vectors), 1)
        memory_id, embedding, metadata = self.saved_vectors[0]
        self.assertEqual(memory_id, "mem_test")
        self.assertEqual(embedding, [float(len(self.markdown_content)), 1.0])
        self.assertEqual(metadata, {
            "type": "idea",
            "project": "arkan",
            "tags": "semantic-search",
        })
        self.assertEqual(len(self.embedding_events), 1)
        self.assertEqual(self.embedding_events[0].memory_id, "mem_test")
        self.assertEqual(self.embedding_events[0].model, "test-model")

    def test_start_is_idempotent(self):
        self.pipeline.start_knowledge_pipeline()
        self.pipeline.start_knowledge_pipeline()
        self.bus.publish(self.MemoryCreated(memory_id="mem_test", type="memory"))

        self.assertEqual(len(self.saved_vectors), 1)

    def test_missing_markdown_skips_embedding(self):
        self.markdown_content = None
        self.pipeline.start_knowledge_pipeline()
        self.bus.publish(self.MemoryCreated(memory_id="mem_test", type="memory"))

        self.assertEqual(self.saved_vectors, [])
        self.assertEqual(self.embedding_events, [])
        self.assertEqual(self.deleted_vectors, ["mem_test"])

    def test_relevant_update_regenerates_embedding(self):
        self.pipeline.start_knowledge_pipeline()
        self.bus.publish(self.MemoryUpdated(
            memory_id="mem_test",
            changed_fields=["content"],
            type="memory",
            project="arkan",
            tags=["updated"],
        ))

        self.assertEqual(len(self.saved_vectors), 1)
        self.assertEqual(self.saved_vectors[0][2]["tags"], "updated")

    def test_unrelated_update_does_not_regenerate_embedding(self):
        self.pipeline.start_knowledge_pipeline()
        self.bus.publish(self.MemoryUpdated(
            memory_id="mem_test",
            changed_fields=["context"],
            type="memory",
        ))

        self.assertEqual(self.saved_vectors, [])

    def test_delete_removes_vector(self):
        self.pipeline.start_knowledge_pipeline()
        self.bus.publish(self.MemoryDeleted(memory_id="mem_test"))

        self.assertEqual(self.deleted_vectors, ["mem_test"])


if __name__ == "__main__":
    unittest.main()
