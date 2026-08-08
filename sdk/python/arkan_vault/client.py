"""Small dependency-free client for agents that use Arkan Vault."""
from __future__ import annotations

import json
import os
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


class ArkanVaultError(RuntimeError):
    """Raised when the Vault cannot complete an operation."""


Transport = Callable[[Request, float], Any]


class ArkanVaultClient:
    def __init__(
        self,
        base_url: str | None = None,
        *,
        timeout: float = 3.0,
        transport: Transport | None = None,
    ) -> None:
        configured = base_url or os.getenv(
            "ARKAN_VAULT_URL",
            "https://arkan-server.tail9b08be.ts.net",
        )
        self.base_url = configured.rstrip("/")
        self.api_url = f"{self.base_url}/api/v1"
        self.timeout = timeout
        self._transport = transport or self._default_transport

    def health(self) -> dict[str, Any]:
        return self._request("GET", "/health", api=False)

    def remember(
        self,
        text: str,
        context: dict[str, Any] | None = None,
        *,
        title: str | None = None,
        memory_type: str = "memory",
        summary: str | None = None,
        project: str | None = None,
        tags: list[str] | None = None,
        relations: list[str] | None = None,
    ) -> dict[str, Any]:
        text = text.strip()
        if not text:
            raise ValueError("text must not be empty")
        memory_context = dict(context or {})
        memory_context.setdefault("source", "hermes")
        memory_context.setdefault("created_by", "Hermes")
        payload = {
            "type": memory_type,
            "title": title or self._title_from(text),
            "summary": summary,
            "content": text,
            "project": project,
            "tags": tags or [],
            "relations": relations or [],
            "context": memory_context,
        }
        return self._request("POST", "/memories", payload)

    def search(
        self,
        query: str,
        *,
        limit: int = 10,
        mode: str = "hybrid",
        memory_type: str | None = None,
        project: str | None = None,
        tags: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        if mode not in {"hybrid", "semantic", "text"}:
            raise ValueError("mode must be hybrid, semantic, or text")
        params: list[tuple[str, Any]] = [("q", query), ("limit", limit), ("mode", mode)]
        if memory_type:
            params.append(("type", memory_type))
        if project:
            params.append(("project", project))
        params.extend(("tags", tag) for tag in (tags or []))
        return self._request("GET", f"/memories/search?{urlencode(params)}")

    def get_memory(self, memory_id: str) -> dict[str, Any]:
        return self._request("GET", f"/memories/{memory_id}")

    def update_memory(self, memory_id: str, **fields: Any) -> dict[str, Any]:
        """Update the supplied fields of an existing memory."""
        allowed = {"title", "summary", "content", "project", "tags", "relations", "context"}
        unknown = set(fields) - allowed
        if unknown:
            raise ValueError(f"unsupported memory fields: {', '.join(sorted(unknown))}")
        if not fields:
            raise ValueError("at least one field must be supplied")
        return self._request("PUT", f"/memories/{memory_id}", fields)

    def delete_memory(self, memory_id: str) -> None:
        """Permanently remove a memory from the Vault."""
        self._request("DELETE", f"/memories/{memory_id}")

    def list_memories(
        self,
        *,
        memory_type: str | None = None,
        project: str | None = None,
        tags: list[str] | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        params: list[tuple[str, Any]] = [("limit", limit), ("offset", offset)]
        if memory_type:
            params.append(("type", memory_type))
        if project:
            params.append(("project", project))
        params.extend(("tags", tag) for tag in (tags or []))
        return self._request("GET", f"/memories?{urlencode(params)}")

    def list_files(self, *, limit: int = 200, offset: int = 0) -> list[dict[str, Any]]:
        """List the exact file inventory, without semantic ranking."""
        if not 1 <= limit <= 1000:
            raise ValueError("limit must be between 1 and 1000")
        if offset < 0:
            raise ValueError("offset must not be negative")
        return self._request("GET", f"/files?{urlencode({'limit': limit, 'offset': offset})}")

    def _request(
        self,
        method: str,
        path: str,
        payload: dict[str, Any] | None = None,
        *,
        api: bool = True,
    ) -> Any:
        url = f"{self.api_url if api else self.base_url}{path}"
        body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
        request = Request(url, data=body, method=method)
        request.add_header("Accept", "application/json")
        if body is not None:
            request.add_header("Content-Type", "application/json; charset=utf-8")
        try:
            response = self._transport(request, self.timeout)
            raw = response.read()
            return None if not raw else json.loads(raw.decode("utf-8"))
        except HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            try:
                detail = json.loads(detail).get("detail", detail)
            except json.JSONDecodeError:
                pass
            raise ArkanVaultError(f"Vault returned HTTP {error.code}: {detail}") from error
        except (URLError, TimeoutError, OSError) as error:
            raise ArkanVaultError(f"Could not reach Arkan Vault at {self.base_url}: {error}") from error

    @staticmethod
    def _default_transport(request: Request, timeout: float):
        return urlopen(request, timeout=timeout)

    @staticmethod
    def _title_from(text: str) -> str:
        first_line = text.splitlines()[0].strip().lstrip("# ")
        return (first_line[:77] + "...") if len(first_line) > 80 else first_line
