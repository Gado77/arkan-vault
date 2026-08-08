"""Arkan Vault external memory provider for Hermes Agent."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, List

from agent.memory_provider import MemoryProvider
from tools.registry import tool_error


def _load_client_class():
    try:
        from arkan_vault import ArkanVaultClient
        return ArkanVaultClient
    except ImportError:
        sdk_path = os.environ.get("ARKAN_VAULT_SDK_PATH", "")
        if sdk_path and sdk_path not in sys.path:
            sys.path.insert(0, sdk_path)
        from arkan_vault import ArkanVaultClient
        return ArkanVaultClient


def _load_config() -> dict[str, Any]:
    config: dict[str, Any] = {
        "url": os.environ.get("ARKAN_VAULT_URL", "https://arkan-server.tail9b08be.ts.net"),
        "project": os.environ.get("ARKAN_VAULT_PROJECT", ""),
        "sync_turns": os.environ.get("ARKAN_VAULT_SYNC_TURNS", "false"),
        "prefetch_limit": os.environ.get("ARKAN_VAULT_PREFETCH_LIMIT", "8"),
    }
    try:
        from hermes_constants import get_hermes_home
        path = get_hermes_home() / "arkan.json"
        if path.exists():
            config.update({k: v for k, v in json.loads(path.read_text(encoding="utf-8")).items() if v is not None})
    except Exception:
        pass
    return config


SEARCH_SCHEMA = {
    "name": "arkan_search",
    "description": "Search durable Arkan memory by meaning. Use before answering questions about prior projects, preferences, decisions, tasks, or conversations.",
    "parameters": {"type": "object", "properties": {
        "query": {"type": "string", "description": "What to recall."},
        "limit": {"type": "integer", "description": "Maximum results (default 10, max 50)."},
        "project": {"type": "string", "description": "Optional project filter."},
        "tags": {"type": "array", "items": {"type": "string"}},
    }, "required": ["query"]},
}
ADD_SCHEMA = {
    "name": "arkan_remember",
    "description": "Store a durable fact, preference, decision, task, or lesson in Arkan Vault. Skip transient chat and duplicates.",
    "parameters": {"type": "object", "properties": {
        "content": {"type": "string"}, "title": {"type": "string"},
        "memory_type": {"type": "string", "description": "memory, task, idea, decision, etc."},
        "project": {"type": "string"}, "tags": {"type": "array", "items": {"type": "string"}},
    }, "required": ["content"]},
}
UPDATE_SCHEMA = {
    "name": "arkan_update",
    "description": "Correct an Arkan memory by ID. Obtain the ID from arkan_search.",
    "parameters": {"type": "object", "properties": {
        "memory_id": {"type": "string"}, "content": {"type": "string"},
        "title": {"type": "string"}, "project": {"type": "string"},
        "tags": {"type": "array", "items": {"type": "string"}},
    }, "required": ["memory_id"]},
}
DELETE_SCHEMA = {
    "name": "arkan_forget",
    "description": "Permanently delete an obsolete Arkan memory by ID. Prefer arkan_update when a fact merely changed.",
    "parameters": {"type": "object", "properties": {"memory_id": {"type": "string"}}, "required": ["memory_id"]},
}
LIST_SCHEMA = {
    "name": "arkan_list",
    "description": "List the exact Arkan memory inventory without semantic ranking. Use for counts, audits, exhaustive listings, or questions asking whether these are all records.",
    "parameters": {"type": "object", "properties": {
        "memory_type": {"type": "string", "description": "Optional exact type filter, such as file, project, task, or person."},
        "project": {"type": "string"},
        "tags": {"type": "array", "items": {"type": "string"}},
        "limit": {"type": "integer", "description": "Page size (default 200, max 200)."},
        "offset": {"type": "integer", "description": "Pagination offset."},
    }},
}
FILES_SCHEMA = {
    "name": "arkan_files",
    "description": "List the exact Arkan binary file library. Use for file counts, filenames, MIME types, sizes, hashes, and exhaustive file inventory questions; do not use semantic search for those questions.",
    "parameters": {"type": "object", "properties": {
        "limit": {"type": "integer", "description": "Page size (default 200, max 1000)."},
        "offset": {"type": "integer", "description": "Pagination offset."},
    }},
}


class ArkanMemoryProvider(MemoryProvider):
    def __init__(self) -> None:
        self._client = None
        self._config: dict[str, Any] = {}
        self._session_id = ""
        self._platform = "cli"

    @property
    def name(self) -> str:
        return "arkan"

    def is_available(self) -> bool:
        return bool(_load_config().get("url"))

    def get_config_schema(self):
        return [
            {"key": "url", "description": "Arkan Vault base URL", "default": "https://arkan-server.tail9b08be.ts.net", "env_var": "ARKAN_VAULT_URL"},
            {"key": "project", "description": "Default project filter (optional)", "required": False, "env_var": "ARKAN_VAULT_PROJECT"},
            {"key": "sync_turns", "description": "Store complete conversation turns automatically", "default": "false", "choices": ["true", "false"]},
            {"key": "prefetch_limit", "description": "Memories injected before each turn", "default": "8"},
        ]

    def save_config(self, values, hermes_home):
        path = Path(hermes_home) / "arkan.json"
        current = {}
        if path.exists():
            current = json.loads(path.read_text(encoding="utf-8"))
        current.update(values)
        try:
            from utils import atomic_json_write
            atomic_json_write(path, current, mode=0o600)
        except ImportError:
            path.write_text(json.dumps(current, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    def initialize(self, session_id: str, **kwargs) -> None:
        self._config = _load_config()
        self._session_id = session_id
        self._platform = kwargs.get("platform") or "cli"
        client_cls = _load_client_class()
        self._client = client_cls(self._config.get("url"))
        self._client.health()

    def system_prompt_block(self) -> str:
        project = self._config.get("project") or "all projects"
        return (
            "# Arkan Vault Memory\n"
            f"Active durable memory for {project}. Search Arkan before answering questions that may depend on "
            "past preferences, projects, decisions, tasks, people, or conversations. Store lasting facts with "
            "arkan_remember; correct or forget them by ID. Built-in Hermes memory remains available for its small curated profile."
        )

    def _project(self, explicit: str | None = None) -> str | None:
        return explicit or self._config.get("project") or None

    def prefetch(self, query: str, *, session_id: str = "") -> str:
        if not query or self._client is None:
            return ""
        limit = max(1, min(int(self._config.get("prefetch_limit", 8)), 20))
        results = self._client.search(query, limit=limit, project=self._project())
        lines = [self._format_result(item) for item in results]
        return "## Relevant Arkan memories\n" + "\n".join(lines) if lines else ""

    def sync_turn(self, user_content: str, assistant_content: str, *, session_id: str = "") -> None:
        enabled = str(self._config.get("sync_turns", "false")).lower() in {"true", "1", "yes"}
        if not enabled or self._client is None:
            return
        content = f"User:\n{user_content}\n\nAssistant:\n{assistant_content}"
        self._client.remember(content, {
            "source": "hermes-turn", "created_by": "Hermes", "session_id": session_id or self._session_id,
            "platform": self._platform,
        }, title=f"Hermes turn: {user_content[:80]}", memory_type="conversation", project=self._project(), tags=["hermes", "conversation"])

    def get_tool_schemas(self) -> List[Dict[str, Any]]:
        return [SEARCH_SCHEMA, LIST_SCHEMA, FILES_SCHEMA, ADD_SCHEMA, UPDATE_SCHEMA, DELETE_SCHEMA]

    @staticmethod
    def _format_result(item: dict[str, Any]) -> str:
        memory = item.get("memory") if isinstance(item.get("memory"), dict) else item
        memory_id = item.get("memory_id") or memory.get("id", "?")
        title = memory.get("title") or "Untitled"
        content = memory.get("summary") or memory.get("content") or ""
        content = str(content).strip().replace("\n", " ")[:600]
        score = item.get("score")
        suffix = f" score={score:.3f}" if isinstance(score, (int, float)) else ""
        return f"- [{memory_id}] {title}: {content}{suffix}"

    @staticmethod
    def _normalize_result(item: dict[str, Any]) -> dict[str, Any]:
        memory = item.get("memory") if isinstance(item.get("memory"), dict) else item
        return {
            "id": item.get("memory_id") or memory.get("id"),
            "type": memory.get("type"),
            "title": memory.get("title"),
            "summary": memory.get("summary"),
            "content": memory.get("content"),
            "project": memory.get("project"),
            "tags": memory.get("tags", []),
            "score": item.get("score"),
            "search_type": item.get("search_type"),
        }

    def handle_tool_call(self, tool_name: str, args: dict, **kwargs) -> str:
        if self._client is None:
            return tool_error("Arkan Vault is not initialized")
        try:
            if tool_name == "arkan_search":
                query = str(args.get("query", "")).strip()
                if not query:
                    return tool_error("Missing required parameter: query")
                limit = max(1, min(int(args.get("limit", 10)), 50))
                results = self._client.search(query, limit=limit, project=self._project(args.get("project")), tags=args.get("tags"))
                normalized = [self._normalize_result(item) for item in results]
                return json.dumps({"results": normalized, "count": len(normalized)}, ensure_ascii=False, default=str)
            if tool_name == "arkan_list":
                limit = max(1, min(int(args.get("limit", 200)), 200))
                offset = max(0, int(args.get("offset", 0)))
                results = self._client.list_memories(
                    memory_type=args.get("memory_type"), project=self._project(args.get("project")),
                    tags=args.get("tags"), limit=limit, offset=offset,
                )
                return json.dumps({"results": results, "count": len(results), "limit": limit, "offset": offset}, ensure_ascii=False, default=str)
            if tool_name == "arkan_files":
                limit = max(1, min(int(args.get("limit", 200)), 1000))
                offset = max(0, int(args.get("offset", 0)))
                results = self._client.list_files(limit=limit, offset=offset)
                items = [{
                    "id": item.get("id"), "filename": item.get("context", {}).get("original_filename") or item.get("title"),
                    "mime_type": item.get("context", {}).get("mime_type"), "size_bytes": item.get("context", {}).get("size_bytes"),
                    "sha256": item.get("context", {}).get("sha256"), "project": item.get("project"), "tags": item.get("tags", []),
                } for item in results]
                return json.dumps({"files": items, "count": len(items), "limit": limit, "offset": offset}, ensure_ascii=False, default=str)
            if tool_name == "arkan_remember":
                content = str(args.get("content", "")).strip()
                if not content:
                    return tool_error("Missing required parameter: content")
                result = self._client.remember(content, {
                    "source": "hermes", "created_by": "Hermes", "session_id": self._session_id, "platform": self._platform,
                }, title=args.get("title"), memory_type=args.get("memory_type", "memory"), project=self._project(args.get("project")), tags=args.get("tags"))
                return json.dumps(result, ensure_ascii=False, default=str)
            if tool_name == "arkan_update":
                memory_id = str(args.get("memory_id", "")).strip()
                if not memory_id:
                    return tool_error("Missing required parameter: memory_id")
                fields = {key: args[key] for key in ("content", "title", "project", "tags") if key in args}
                if not fields:
                    return tool_error("Supply at least one field to update")
                return json.dumps(self._client.update_memory(memory_id, **fields), ensure_ascii=False, default=str)
            if tool_name == "arkan_forget":
                memory_id = str(args.get("memory_id", "")).strip()
                if not memory_id:
                    return tool_error("Missing required parameter: memory_id")
                self._client.delete_memory(memory_id)
                return json.dumps({"result": "Memory deleted", "id": memory_id})
            return tool_error(f"Unknown tool: {tool_name}")
        except Exception as exc:
            return tool_error(f"Arkan Vault operation failed: {exc}")


def register(ctx) -> None:
    ctx.register_memory_provider(ArkanMemoryProvider())
