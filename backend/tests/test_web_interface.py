import unittest

from fastapi.testclient import TestClient

from app.main import app


class WebInterfaceTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_root_serves_web_interface(self):
        response = self.client.get("/")

        self.assertEqual(response.status_code, 200)
        self.assertIn("Arkan Vault", response.text)
        self.assertIn('id="memory-grid"', response.text)

    def test_static_assets_are_served(self):
        stylesheet = self.client.get("/assets/styles.css")
        script = self.client.get("/assets/app.js")

        self.assertEqual(stylesheet.status_code, 200)
        self.assertIn("--gold", stylesheet.text)
        self.assertEqual(script.status_code, 200)
        self.assertIn("async function boot", script.text)


if __name__ == "__main__":
    unittest.main()
