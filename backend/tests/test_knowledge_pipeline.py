import pytest
from unittest.mock import MagicMock, patch
from app.events.memory_events import MemoryCreated, MemoryUpdated, MemoryDeleted
from app.workers.knowledge_pipeline import start_knowledge_pipeline

@pytest.fixture
def mock_storages():
    with patch("app.workers.knowledge_pipeline.ChromaVectorStorage") as MockChroma, \
         patch("app.workers.knowledge_pipeline.FilesystemMarkdownStorage") as MockMarkdown, \
         patch("app.workers.knowledge_pipeline.embeddings") as mock_embeddings, \
         patch("app.workers.knowledge_pipeline.bus") as mock_bus:
         
        mock_chroma_inst = MockChroma.return_value
        mock_markdown_inst = MockMarkdown.return_value
        
        # Reset _started flag so it initializes inside tests
        import app.workers.knowledge_pipeline as kp
        kp._started = False
        
        yield mock_chroma_inst, mock_markdown_inst, mock_embeddings, mock_bus

def test_pipeline_memory_created(mock_storages):
    mock_chroma, mock_markdown, mock_embeddings, mock_bus = mock_storages
    
    # We can get the handlers by capturing the bus.subscribe calls
    handlers = {}
    def fake_subscribe(event_cls, handler):
        handlers[event_cls.__name__] = handler
    mock_bus.subscribe.side_effect = fake_subscribe
    
    start_knowledge_pipeline()
    
    mock_markdown.get.return_value = "Content"
    mock_embeddings.embed.return_value = [0.1, 0.2]
    
    event = MemoryCreated(memory_id="mem_1", type="idea", project="test", tags=["a"])
    handlers["MemoryCreated"](event)
    
    mock_chroma.save.assert_called_once_with("mem_1", [0.1, 0.2], {"type": "idea", "project": "test", "tags": "a"})
    assert mock_bus.publish.called

def test_pipeline_memory_updated_content(mock_storages):
    mock_chroma, mock_markdown, mock_embeddings, mock_bus = mock_storages
    
    handlers = {}
    def fake_subscribe(event_cls, handler):
        handlers[event_cls.__name__] = handler
    mock_bus.subscribe.side_effect = fake_subscribe
    
    start_knowledge_pipeline()
    
    mock_markdown.get.return_value = "New Content"
    mock_embeddings.embed.return_value = [0.3, 0.4]
    
    event = MemoryUpdated(memory_id="mem_1", changed_fields=["content"], type="idea", project="test", tags=[])
    handlers["MemoryUpdated"](event)
    
    mock_chroma.save.assert_called_once_with("mem_1", [0.3, 0.4], {"type": "idea", "project": "test"})

def test_pipeline_memory_updated_title_only(mock_storages):
    mock_chroma, mock_markdown, mock_embeddings, mock_bus = mock_storages
    
    handlers = {}
    def fake_subscribe(event_cls, handler):
        handlers[event_cls.__name__] = handler
    mock_bus.subscribe.side_effect = fake_subscribe
    
    start_knowledge_pipeline()
    
    event = MemoryUpdated(memory_id="mem_1", changed_fields=["title"], type="idea", project="test", tags=[])
    handlers["MemoryUpdated"](event)
    
    mock_chroma.save.assert_not_called()

def test_pipeline_memory_deleted(mock_storages):
    mock_chroma, mock_markdown, mock_embeddings, mock_bus = mock_storages
    
    handlers = {}
    def fake_subscribe(event_cls, handler):
        handlers[event_cls.__name__] = handler
    mock_bus.subscribe.side_effect = fake_subscribe
    
    start_knowledge_pipeline()
    
    event = MemoryDeleted(memory_id="mem_1")
    handlers["MemoryDeleted"](event)
    
    mock_chroma.delete.assert_called_once_with("mem_1")
