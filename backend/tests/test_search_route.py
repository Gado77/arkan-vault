import unittest

from fastapi.testclient import TestClient

from app.api.routes.memory import get_search_service
from app.main import app


class SearchRouteTests(unittest.TestCase):
    def setUp(self):
        self.calls = []
        test = self

        class FakeSearchService:
            def search(self, **kwargs):
                test.calls.append(kwargs)
                return []

        app.dependency_overrides[get_search_service] = FakeSearchService
        self.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.clear()

    def test_search_endpoint_forwards_query_and_filters(self):
        response = self.client.get(
            "/api/v1/memories/search",
            params=[
                ("q", "semantic memory"),
                ("limit", "7"),
                ("type", "idea"),
                ("project", "arkan"),
                ("tags", "machine-learning"),
                ("tags", "stage-3"),
                ("mode", "text"),
            ],
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])
        self.assertEqual(self.calls, [{
            "q": "semantic memory",
            "limit": 7,
            "type": "idea",
            "project": "arkan",
            "tags": ["machine-learning", "stage-3"],
            "mode": "text",
        }])

    def test_search_endpoint_validates_query(self):
        response = self.client.get("/api/v1/memories/search", params={"q": ""})

        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.calls, [])

    def test_search_endpoint_rejects_unknown_mode(self):
        response = self.client.get(
            "/api/v1/memories/search",
            params={"q": "memory", "mode": "unknown"},
        )

        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.calls, [])


if __name__ == "__main__":
    unittest.main()
