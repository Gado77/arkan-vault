import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
import tempfile
import shutil

from app.main import app
from app.database import Base, get_db
from app.models.memory import MemoryObject
from app.api.routes.memory import get_memory_service
from app.services.memory_service import MemoryService
from app.storage.metadata_storage import SQLiteMetadataStorage
from app.storage.markdown_storage import FilesystemMarkdownStorage
from app.events import bus

from sqlalchemy.pool import StaticPool

# Setup SQLite in-memory for tests
SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL, 
    connect_args={"check_same_thread": False},
    poolclass=StaticPool
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()

app.dependency_overrides[get_db] = override_get_db

@pytest.fixture(scope="function")
def db_session():
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    yield db
    db.close()
    Base.metadata.drop_all(bind=engine)

@pytest.fixture(scope="function")
def temp_markdown_dir():
    temp_dir = tempfile.mkdtemp()
    yield temp_dir
    shutil.rmtree(temp_dir)

@pytest.fixture(scope="function")
def override_memory_service(db_session, temp_markdown_dir):
    def _override():
        return MemoryService(
            metadata=SQLiteMetadataStorage(db_session),
            markdown=FilesystemMarkdownStorage(temp_markdown_dir),
        )
    app.dependency_overrides[get_memory_service] = _override
    yield
    app.dependency_overrides.pop(get_memory_service, None)

@pytest.fixture(scope="function")
def client(override_memory_service):
    from copy import deepcopy
    original_handlers = deepcopy(bus._handlers)
    bus.clear()
    
    with TestClient(app) as c:
        yield c
        
    bus._handlers.clear()
    bus._handlers.update(original_handlers)

def test_create_and_get_memory(client):
    payload = {
        "title": "A title",
        "content": "A content",
        "project": "test",
        "tags": ["test"],
        "context": {"source": "test"}
    }
    post_response = client.post("/api/v1/memories", json=payload)
    assert post_response.status_code == 201
    created = post_response.json()
    assert created["title"] == "A title"
    assert created["content"] == "A content"
    
    mem_id = created["id"]
    
    get_response = client.get(f"/api/v1/memories/{mem_id}")
    assert get_response.status_code == 200
    fetched = get_response.json()
    assert fetched["id"] == mem_id
    assert fetched["title"] == "A title"

def test_put_partial_update(client):
    payload = {
        "title": "A",
        "content": "conteudo",
        "project": "hermes",
        "tags": ["teste"],
        "context": {"source": "test"}
    }
    create_resp = client.post("/api/v1/memories", json=payload)
    mem_id = create_resp.json()["id"]

    put_payload = {"title": "B"}
    put_resp = client.put(f"/api/v1/memories/{mem_id}", json=put_payload)
    assert put_resp.status_code == 200
    updated = put_resp.json()
    assert updated["title"] == "B"
    assert updated["content"] == "conteudo"
    assert updated["project"] == "hermes"
    assert updated["tags"] == ["teste"]
    
def test_patch_partial_update(client):
    payload = {
        "title": "A",
        "content": "conteudo",
        "project": "hermes",
        "tags": ["teste"],
        "context": {"source": "test"}
    }
    create_resp = client.post("/api/v1/memories", json=payload)
    mem_id = create_resp.json()["id"]

    patch_payload = {"title": "B"}
    patch_resp = client.patch(f"/api/v1/memories/{mem_id}", json=patch_payload)
    assert patch_resp.status_code == 200
    updated = patch_resp.json()
    assert updated["title"] == "B"
    assert updated["content"] == "conteudo"
    assert updated["project"] == "hermes"
    assert updated["tags"] == ["teste"]

def test_update_nonexistent(client):
    put_resp = client.put("/api/v1/memories/invalid-id", json={"title": "new"})
    assert put_resp.status_code == 404
    
    patch_resp = client.patch("/api/v1/memories/invalid-id", json={"title": "new"})
    assert patch_resp.status_code == 404

def test_delete_memory(client):
    create_resp = client.post("/api/v1/memories", json={"title": "T", "content": "C"})
    mem_id = create_resp.json()["id"]

    del_resp = client.delete(f"/api/v1/memories/{mem_id}")
    assert del_resp.status_code == 204

    get_resp = client.get(f"/api/v1/memories/{mem_id}")
    assert get_resp.status_code == 404

def test_delete_nonexistent(client):
    del_resp = client.delete("/api/v1/memories/invalid-id")
    assert del_resp.status_code == 404

def test_compensatory_rollback_on_update(client, db_session, temp_markdown_dir):
    create_resp = client.post("/api/v1/memories", json={"title": "T", "content": "Original Content"})
    mem_id = create_resp.json()["id"]
    
    service = MemoryService(
        metadata=SQLiteMetadataStorage(db_session),
        markdown=FilesystemMarkdownStorage(temp_markdown_dir)
    )
    
    original_update = service.metadata.update
    def failing_update(*args, **kwargs):
        raise Exception("Simulated DB failure")
    
    service.metadata.update = failing_update
    
    from app.schemas.memory import MemoryUpdate
    with pytest.raises(Exception, match="Simulated DB failure"):
        service.update(mem_id, MemoryUpdate(content="New Content"))
        
    content = service.markdown.get(mem_id)
    assert content == "Original Content"

def test_compensatory_rollback_on_delete(client, db_session, temp_markdown_dir):
    create_resp = client.post("/api/v1/memories", json={"title": "T", "content": "Original Content"})
    mem_id = create_resp.json()["id"]
    
    service = MemoryService(
        metadata=SQLiteMetadataStorage(db_session),
        markdown=FilesystemMarkdownStorage(temp_markdown_dir)
    )
    
    def failing_delete(*args, **kwargs):
        raise Exception("Simulated DB delete failure")
    
    service.metadata.delete = failing_delete
    
    with pytest.raises(Exception, match="Simulated DB delete failure"):
        service.delete(mem_id)
        
    content = service.markdown.get(mem_id)
    assert content == "Original Content"
