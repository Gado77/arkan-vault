import importlib.util
import json
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch

agent_module = types.ModuleType("agent")
provider_module = types.ModuleType("agent.memory_provider")
provider_module.MemoryProvider = object
registry_module = types.ModuleType("tools.registry")
registry_module.tool_error = lambda message: json.dumps({"error": message})
sys.modules.setdefault("agent", agent_module)
sys.modules["agent.memory_provider"] = provider_module
sys.modules.setdefault("tools", types.ModuleType("tools"))
sys.modules["tools.registry"] = registry_module

PLUGIN = Path(__file__).resolve().parents[1] / "plugins" / "memory" / "arkan" / "__init__.py"
spec = importlib.util.spec_from_file_location("arkan_provider", PLUGIN)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class FakeClient:
    def __init__(self, url=None): self.url, self.calls = url, []
    def health(self): return {"status": "ok"}
    def search(self, query, **kwargs):
        self.calls.append(("search", query, kwargs))
        return [{"memory_id": "mem_1", "memory": {"id": "mem_1", "title": "Preferência", "content": "Prefere respostas curtas"}, "score": 0.9}]
    def remember(self, content, context, **kwargs):
        self.calls.append(("remember", content, context, kwargs)); return {"id": "mem_2"}
    def update_memory(self, memory_id, **fields):
        self.calls.append(("update", memory_id, fields)); return {"id": memory_id, **fields}
    def delete_memory(self, memory_id): self.calls.append(("delete", memory_id))
    def list_memories(self, **kwargs):
        self.calls.append(("list", kwargs)); return [{"id": "mem_1", "type": "file", "title": "a.zip"}]
    def list_files(self, **kwargs):
        self.calls.append(("files", kwargs)); return [{"id": "mem_1", "title": "a.zip", "tags": ["file"], "context": {"original_filename": "a.zip", "mime_type": "application/zip", "size_bytes": 42, "sha256": "abc"}}]


class ProviderTests(unittest.TestCase):
    def setUp(self):
        self.client = FakeClient()
        self.provider = module.ArkanMemoryProvider()
        self.provider._client = self.client
        self.provider._config = {"project": "arkan-vault", "prefetch_limit": 8, "sync_turns": "false"}
        self.provider._session_id = "session-1"
        self.provider._platform = "cli"

    def test_prefetch_formats_relevant_memory(self):
        result = self.provider.prefetch("como devo responder?")
        self.assertIn("mem_1", result)
        self.assertIn("Prefere respostas curtas", result)
        self.assertEqual(self.client.calls[0][2]["project"], "arkan-vault")

    def test_remember_adds_hermes_context(self):
        result = json.loads(self.provider.handle_tool_call("arkan_remember", {"content": "Usa Python"}))
        self.assertEqual(result["id"], "mem_2")
        call = self.client.calls[0]
        self.assertEqual(call[2]["source"], "hermes")
        self.assertEqual(call[2]["session_id"], "session-1")

    def test_sync_turns_is_opt_in(self):
        self.provider.sync_turn("oi", "olá")
        self.assertEqual(self.client.calls, [])
        self.provider._config["sync_turns"] = "true"
        self.provider.sync_turn("oi", "olá")
        self.assertEqual(self.client.calls[0][0], "remember")

    def test_update_and_forget(self):
        self.provider.handle_tool_call("arkan_update", {"memory_id": "mem_1", "content": "novo"})
        self.provider.handle_tool_call("arkan_forget", {"memory_id": "mem_1"})
        self.assertEqual(self.client.calls[0], ("update", "mem_1", {"content": "novo"}))
        self.assertEqual(self.client.calls[1], ("delete", "mem_1"))

    def test_exact_memory_and_file_inventory(self):
        memories = json.loads(self.provider.handle_tool_call("arkan_list", {"memory_type": "file"}))
        files = json.loads(self.provider.handle_tool_call("arkan_files", {}))
        self.assertEqual(memories["count"], 1)
        self.assertEqual(files["files"][0]["filename"], "a.zip")
        self.assertEqual(self.client.calls[0][0], "list")
        self.assertEqual(self.client.calls[1][0], "files")


if __name__ == "__main__":
    unittest.main()
