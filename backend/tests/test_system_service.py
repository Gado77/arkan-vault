from pathlib import Path
from app.schemas.system import BackupStatus
from app.services.system_service import SystemService

class MetadataStub:
    def list(self, **kwargs):
        return [type("M", (), {"type": "memory"})(), type("M", (), {"type": "file"})()]

def test_system_status_reports_metrics(monkeypatch, tmp_path: Path):
    memories = tmp_path / "memories"
    memories.mkdir()
    (memories / "one.md").write_text("memory", encoding="utf-8")
    monkeypatch.setattr("app.services.system_service.settings.MEMORIES_PATH", str(memories))
    monkeypatch.setattr(SystemService, "_latest_backup", staticmethod(lambda: BackupStatus(available=False)))
    result = SystemService(MetadataStub()).status()
    assert (result.memories, result.files, result.markdown_files) == (2, 1, 1)
    assert result.storage.vault_bytes == 6
