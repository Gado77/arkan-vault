from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from fastapi.testclient import TestClient

from app.api.routes.file import get_file_service
from app.main import app
from app.models.memory import MemoryObject
from app.services.file_service import FileService
from app.storage.file_storage import FilesystemFileStorage


class Metadata:
    def __init__(self):
        self.items = []

    def find_by_context(self, key, value, type=None):
        return next((item for item in self.items if (not type or item.type == type) and item.context.get(key) == value), None)

    def list(self, type=None, limit=200, offset=0, **kwargs):
        return [item for item in self.items if not type or item.type == type][offset:offset + limit]

    def get(self, id):
        return next((item for item in self.items if item.id == id), None)


class Memories:
    def __init__(self, metadata):
        self.metadata = metadata
        self.created = 0

    def create(self, data):
        self.created += 1
        memory = MemoryObject(
            id=f"mem_file_{self.created}", type=data.type, title=data.title,
            summary=data.summary, content=data.content, project=data.project,
            tags=data.tags, relations=data.relations, context=data.context,
        )
        self.metadata.items.append(memory)
        return memory

    def delete(self, id):
        memory = self.metadata.get(id)
        if not memory:
            return False
        self.metadata.items.remove(memory)
        return True


class FileStorageTests(unittest.TestCase):
    def test_stores_by_hash_and_deduplicates_blob(self):
        with TemporaryDirectory() as directory:
            storage = FilesystemFileStorage(directory)
            first = storage.save(BytesIO(b"arkan"), 100)
            second = storage.save(BytesIO(b"arkan"), 100)

            self.assertTrue(first.created)
            self.assertFalse(second.created)
            self.assertEqual(first.key, second.key)
            self.assertEqual(Path(first.path).read_bytes(), b"arkan")

    def test_rejects_files_over_limit_and_removes_temporary_data(self):
        with TemporaryDirectory() as directory:
            storage = FilesystemFileStorage(directory)
            with self.assertRaises(ValueError):
                storage.save(BytesIO(b"too large"), 3)
            self.assertEqual(list((Path(directory) / ".tmp").iterdir()), [])

    def test_does_not_resolve_path_traversal(self):
        with TemporaryDirectory() as directory:
            storage = FilesystemFileStorage(directory)
            self.assertIsNone(storage.resolve("../../outside"))

    def test_resumable_upload_enforces_offset_and_finishes(self):
        with TemporaryDirectory() as directory:
            storage = FilesystemFileStorage(directory)
            session = storage.create_upload({"filename": "large.bin", "size_bytes": 10})
            first = storage.append_upload(session["upload_id"], 0, b"01234", 100)
            with self.assertRaises(ValueError):
                storage.append_upload(session["upload_id"], 0, b"wrong", 100)
            second = storage.append_upload(session["upload_id"], 5, b"56789", 100)
            stored, metadata = storage.finish_upload(session["upload_id"], 100)

            self.assertEqual(first["received_bytes"], 5)
            self.assertEqual(second["received_bytes"], 10)
            self.assertEqual(Path(stored.path).read_bytes(), b"0123456789")
            self.assertEqual(metadata["filename"], "large.bin")
            self.assertIsNone(storage.upload_status(session["upload_id"]))

    def test_resumable_upload_verifies_declared_hash(self):
        with TemporaryDirectory() as directory:
            storage = FilesystemFileStorage(directory)
            session = storage.create_upload({"filename": "bad.bin", "size_bytes": 3, "sha256": "0" * 64})
            storage.append_upload(session["upload_id"], 0, b"bad", 100)

            with self.assertRaises(ValueError):
                storage.finish_upload(session["upload_id"], 100)


class FileServiceTests(unittest.TestCase):
    def test_upload_creates_file_memory_and_reuses_duplicate(self):
        with TemporaryDirectory() as directory:
            metadata = Metadata()
            memories = Memories(metadata)
            service = FileService(metadata, memories, FilesystemFileStorage(directory), 1000)

            first, first_duplicate = service.upload(BytesIO(b"content"), "../safe.txt", "text/plain", "arkan")
            second, second_duplicate = service.upload(BytesIO(b"content"), "other.txt", "text/plain")

            self.assertFalse(first_duplicate)
            self.assertTrue(second_duplicate)
            self.assertEqual(first.id, second.id)
            self.assertEqual(first.title, "safe.txt")
            self.assertEqual(first.context["size_bytes"], 7)
            self.assertTrue(first.context["text_extracted"])
            self.assertIn("content", first.content)
            self.assertEqual(memories.created, 1)

    def test_binary_upload_is_not_extracted(self):
        with TemporaryDirectory() as directory:
            metadata = Metadata()
            service = FileService(metadata, Memories(metadata), FilesystemFileStorage(directory), 1000)

            memory, _ = service.upload(BytesIO(b"\x00\x01\x02"), "image.png", "image/png")

            self.assertFalse(memory.context["text_extracted"])
            self.assertEqual(memory.context["extracted_chars"], 0)

    def test_delete_removes_memory_and_blob(self):
        with TemporaryDirectory() as directory:
            metadata = Metadata()
            memories = Memories(metadata)
            storage = FilesystemFileStorage(directory)
            service = FileService(metadata, memories, storage, 1000)
            memory, _ = service.upload(BytesIO(b"content"), "file.bin", None)
            path = service.download(memory.id)[1]

            self.assertTrue(service.delete(memory.id))
            self.assertFalse(Path(path).exists())
            self.assertIsNone(metadata.get(memory.id))


class FileRouteTests(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.path = Path(self.directory.name) / "payload.bin"
        self.path.write_bytes(b"0123456789")
        self.memory = MemoryObject(
            id="mem_file_range", type="file", title="payload.bin",
            tags=["file"], relations=[], project=None, summary=None, content=None,
            context={"source": "upload", "mime_type": "application/octet-stream", "original_filename": "payload.bin"},
        )

        class Service:
            def __init__(inner, memory, path):
                inner.memory = memory
                inner.path = path

            def download(inner, memory_id):
                return (inner.memory, str(inner.path)) if memory_id == inner.memory.id else None

        app.dependency_overrides[get_file_service] = lambda: Service(self.memory, self.path)
        self.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.clear()
        self.directory.cleanup()

    def test_download_supports_byte_ranges(self):
        response = self.client.get("/api/v1/files/mem_file_range/download", headers={"Range": "bytes=2-5"})

        self.assertEqual(response.status_code, 206)
        self.assertEqual(response.content, b"2345")
        self.assertEqual(response.headers["content-range"], "bytes 2-5/10")
        self.assertEqual(response.headers["accept-ranges"], "bytes")

    def test_download_rejects_range_outside_file(self):
        response = self.client.get("/api/v1/files/mem_file_range/download", headers={"Range": "bytes=20-30"})

        self.assertEqual(response.status_code, 416)
        self.assertEqual(response.headers["content-range"], "bytes */10")


if __name__ == "__main__":
    unittest.main()
