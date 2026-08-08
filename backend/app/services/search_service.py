"""Semantic, lexical, and hybrid search orchestration for MemoryObjects."""
from typing import Literal

from app.core import embeddings
from app.core import search as search_core
from app.core import tags as tag_utils
from app.events import bus
from app.events.memory_events import SearchExecuted
from app.schemas.search import ScoreBreakdown, SearchResult
from app.storage.metadata_storage import MetadataStorageBase
from app.storage.vector_storage import VectorStorageBase


SearchMode = Literal["semantic", "text", "hybrid"]
TEXT_CANDIDATE_LIMIT = 1000


class SearchService:
    def __init__(self, metadata: MetadataStorageBase, vector: VectorStorageBase):
        self.metadata = metadata
        self.vector = vector

    def search(
        self,
        q: str,
        limit: int = 10,
        type: str | None = None,
        project: str | None = None,
        tags: list[str] | None = None,
        mode: SearchMode = "hybrid",
    ) -> list[SearchResult]:
        if mode not in {"semantic", "text", "hybrid"}:
            raise ValueError(f"Unsupported search mode: {mode}")

        normalized_tags = tag_utils.normalize_list(tags or [])
        objects: dict[str, object] = {}
        semantic_scores: dict[str, float] = {}
        text_scores: dict[str, float] = {}

        if mode in {"semantic", "hybrid"}:
            semantic_scores, semantic_objects = self._semantic_candidates(
                q=q,
                limit=limit,
                type=type,
                project=project,
                tags=normalized_tags,
                expand=mode == "hybrid",
            )
            objects.update(semantic_objects)

        if mode in {"text", "hybrid"}:
            text_scores, text_objects = self._text_candidates(
                q=q,
                type=type,
                project=project,
                tags=normalized_tags,
            )
            objects.update(text_objects)

        ranked = []
        for memory_id, obj in objects.items():
            semantic = semantic_scores.get(memory_id, 0.0)
            text = text_scores.get(memory_id, 0.0)
            if mode == "semantic":
                score, agreement_bonus = semantic, 0.0
            elif mode == "text":
                score, agreement_bonus = text, 0.0
            else:
                score, agreement_bonus = search_core.hybrid_score(semantic, text)

            if score <= 0.0:
                continue
            ranked.append((score, text, semantic, memory_id, obj, agreement_bonus))

        ranked.sort(key=lambda item: (-item[0], -item[1], -item[2], item[3]))
        results = [
            SearchResult(
                memory_id=memory_id,
                score=score,
                memory=obj,
                search_type=mode,
                score_breakdown=ScoreBreakdown(
                    semantic=semantic,
                    text=text,
                    agreement_bonus=agreement_bonus,
                ),
            )
            for score, text, semantic, memory_id, obj, agreement_bonus in ranked[:limit]
        ]

        bus.publish(SearchExecuted(
            query=q,
            result_count=len(results),
            search_type=mode,
        ))
        return results

    def _semantic_candidates(
        self,
        *,
        q: str,
        limit: int,
        type: str | None,
        project: str | None,
        tags: list[str],
        expand: bool,
    ) -> tuple[dict[str, float], dict[str, object]]:
        filters = self._vector_filters(type=type, project=project)
        candidate_limit = max(limit * 5, 50) if expand or tags else limit
        vector_results = self.vector.search(
            embeddings.embed(q),
            limit=candidate_limit,
            filters=filters or None,
        )

        required_tags = set(tags)
        scores = {}
        objects = {}
        for item in vector_results:
            obj = self.metadata.get(item["memory_id"])
            if not self._matches(obj, type, project, required_tags):
                continue
            scores[obj.id] = item["score"]
            objects[obj.id] = obj
        return scores, objects

    def _text_candidates(
        self,
        *,
        q: str,
        type: str | None,
        project: str | None,
        tags: list[str],
    ) -> tuple[dict[str, float], dict[str, object]]:
        candidates = self.metadata.list(
            type=type,
            project=project,
            tags=tags or None,
            limit=TEXT_CANDIDATE_LIMIT,
            offset=0,
        )
        scores = {}
        objects = {}
        for obj in candidates:
            score = search_core.text_relevance(
                q,
                title=obj.title,
                summary=obj.summary,
                content=obj.content,
                tags=obj.tags,
                project=obj.project,
            )
            if score > 0.0:
                scores[obj.id] = score
                objects[obj.id] = obj
        return scores, objects

    @staticmethod
    def _matches(obj, type, project, required_tags: set[str]) -> bool:
        if obj is None:
            return False
        if type and obj.type != type:
            return False
        if project and obj.project != project:
            return False
        return not required_tags or required_tags.issubset(set(obj.tags))

    @staticmethod
    def _vector_filters(type: str | None, project: str | None) -> dict:
        clauses = []
        if type:
            clauses.append({"type": type})
        if project:
            clauses.append({"project": project})
        if not clauses:
            return {}
        if len(clauses) == 1:
            return clauses[0]
        return {"$and": clauses}
