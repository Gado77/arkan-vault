import gc
from datetime import datetime, timezone
import os
import tempfile
import unittest


@unittest.skipUnless(
    os.getenv("ARKAN_RUN_INTEGRATION") == "1",
    "set ARKAN_RUN_INTEGRATION=1 to run model + ChromaDB integration",
)
class KnowledgePipelineIntegrationTests(unittest.TestCase):
    def test_memory_created_is_embedded_and_persisted(self):
        from app.config import settings
        from app.events import bus
        from app.events.memory_events import EmbeddingGenerated, MemoryCreated
        from app.models.memory import MemoryObject
        from app.services.search_service import SearchService
        from app.storage.chroma_storage import ChromaVectorStorage
        from app.storage.markdown_storage import FilesystemMarkdownStorage
        from app.workers import knowledge_pipeline

        original_chroma_path = settings.CHROMA_PATH
        original_memories_path = settings.MEMORIES_PATH

        with tempfile.TemporaryDirectory(
            prefix="arkan-stage3-",
            ignore_cleanup_errors=True,
        ) as temp_dir:
            settings.CHROMA_PATH = os.path.join(temp_dir, "chroma")
            settings.MEMORIES_PATH = os.path.join(temp_dir, "memories")

            bus.clear()
            knowledge_pipeline._started = False
            generated = []
            bus.subscribe(EmbeddingGenerated, generated.append)

            memory_id = "mem_stage3_integration"
            markdown = FilesystemMarkdownStorage(settings.MEMORIES_PATH)
            markdown.save(memory_id, "Semantic memory for the Arkan Vault integration test.")

            knowledge_pipeline.start_knowledge_pipeline()
            bus.publish(MemoryCreated(
                memory_id=memory_id,
                type="memory",
                project="arkan-vault",
                tags=["stage-3"],
            ))

            vector_storage = ChromaVectorStorage()
            stored = vector_storage.collection.get(ids=[memory_id], include=["embeddings", "metadatas"])

            self.assertEqual(stored["ids"], [memory_id])
            self.assertEqual(len(stored["embeddings"][0]), 384)
            self.assertEqual(stored["metadatas"][0]["project"], "arkan-vault")
            self.assertEqual(len(generated), 1)
            self.assertEqual(generated[0].memory_id, memory_id)

            now = datetime.now(timezone.utc)
            obj = MemoryObject(
                id=memory_id,
                type="memory",
                title="Semantic integration memory",
                summary=None,
                content="Semantic memory for the Arkan Vault integration test.",
                project="arkan-vault",
                tags=["stage-3"],
                relations=[],
                context={"source": "test"},
                markdown_path=None,
                created_at=now,
                updated_at=now,
            )

            class Metadata:
                def get(self, id):
                    return obj if id == memory_id else None

                def list(self, **kwargs):
                    return [obj]

            results = SearchService(Metadata(), vector_storage).search(
                "Arkan semantic memory",
                limit=5,
                type="memory",
                project="arkan-vault",
                tags=["Stage 3"],
            )

            self.assertEqual([result.memory_id for result in results], [memory_id])
            self.assertGreater(results[0].score, 0.0)
            self.assertLessEqual(results[0].score, 1.0)

            del vector_storage
            gc.collect()

        settings.CHROMA_PATH = original_chroma_path
        settings.MEMORIES_PATH = original_memories_path
        bus.clear()
        knowledge_pipeline._started = False


if __name__ == "__main__":
    unittest.main()
