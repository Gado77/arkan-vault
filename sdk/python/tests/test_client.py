import io
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from arkan_vault import ArkanVaultClient


class Response:
    def __init__(self, data):
        self.data = data
    def read(self):
        return json.dumps(self.data).encode()


class ClientTests(unittest.TestCase):
    def setUp(self):
        self.calls = []
        def transport(request, timeout):
            self.calls.append((request, timeout))
            return Response({"ok": True})
        self.client = ArkanVaultClient("https://vault.example", transport=transport)

    def test_remember_sets_hermes_context(self):
        self.client.remember("Comprar SSD", {"source": "voice"}, tags=["hardware"])
        request, _ = self.calls[0]
        payload = json.loads(request.data)
        self.assertEqual(payload["title"], "Comprar SSD")
        self.assertEqual(payload["context"]["source"], "voice")
        self.assertEqual(payload["context"]["created_by"], "Hermes")

    def test_search_encodes_filters(self):
        self.client.search("memória do projeto", project="arkan-vault", tags=["linux server"])
        url = self.calls[0][0].full_url
        self.assertIn("mode=hybrid", url)
        self.assertIn("project=arkan-vault", url)
        self.assertIn("tags=linux+server", url)

    def test_list_uses_pagination(self):
        self.client.list_memories(limit=20, offset=40)
        self.assertIn("limit=20&offset=40", self.calls[0][0].full_url)

    def test_update_memory_sends_only_supplied_fields(self):
        self.client.update_memory("mem_123", content="novo texto", tags=["updated"])
        request, _ = self.calls[0]
        self.assertEqual(request.method, "PUT")
        self.assertTrue(request.full_url.endswith("/api/v1/memories/mem_123"))
        self.assertEqual(json.loads(request.data), {"content": "novo texto", "tags": ["updated"]})

    def test_delete_memory_uses_delete(self):
        self.client.delete_memory("mem_123")
        request, _ = self.calls[0]
        self.assertEqual(request.method, "DELETE")
        self.assertTrue(request.full_url.endswith("/api/v1/memories/mem_123"))

    def test_list_files_uses_exact_inventory_endpoint(self):
        self.client.list_files(limit=100, offset=20)
        request, _ = self.calls[0]
        self.assertEqual(request.method, "GET")
        self.assertTrue(request.full_url.endswith("/api/v1/files?limit=100&offset=20"))


if __name__ == "__main__":
    unittest.main()
