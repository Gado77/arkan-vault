import unittest

from app.core.search import hybrid_score, normalize_text, text_relevance
from app.core.vectors import distance_to_score


class SearchCoreTests(unittest.TestCase):
    def test_normalize_text_ignores_case_accents_and_punctuation(self):
        self.assertEqual(normalize_text("  Memória, SEMÂNTICA! "), "memoria semantica")

    def test_exact_title_match_has_maximum_text_score(self):
        score = text_relevance("memoria semantica", title="Memória Semântica")

        self.assertEqual(score, 1.0)

    def test_content_match_is_weaker_than_title_match(self):
        title_score = text_relevance("arkan vault", title="Arkan Vault")
        content_score = text_relevance("arkan vault", content="Notes about Arkan Vault")

        self.assertGreater(title_score, content_score)

    def test_hybrid_preserves_strongest_signal_and_adds_agreement_bonus(self):
        score, bonus = hybrid_score(0.8, 0.6)

        self.assertEqual(bonus, 0.09)
        self.assertEqual(score, 0.89)

    def test_hybrid_score_is_bounded(self):
        score, bonus = hybrid_score(1.0, 1.0)

        self.assertEqual(score, 1.0)
        self.assertEqual(bonus, 0.15)

    def test_vector_distance_is_normalized_to_score(self):
        self.assertEqual(distance_to_score(0.0), 1.0)
        self.assertEqual(distance_to_score(1.0), 0.5)
        self.assertEqual(distance_to_score(None), 0.0)


if __name__ == "__main__":
    unittest.main()
