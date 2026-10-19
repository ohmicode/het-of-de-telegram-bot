import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

fake_firestore = types.ModuleType('google.cloud.firestore')
fake_firestore.Client = mock.MagicMock()
sys.modules.setdefault('google', types.ModuleType('google'))
sys.modules.setdefault('google.cloud', types.ModuleType('google.cloud'))
sys.modules['google.cloud.firestore'] = fake_firestore
sys.modules['google.cloud'].firestore = fake_firestore

import upload  # noqa: E402

HEADER = 'article,dutch,english,example,explanation'


class DictionaryCsvTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self._temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self._temp_dir.cleanup)

    def write_csv(self, content: str) -> str:
        path = Path(self._temp_dir.name) / 'dictionary.csv'
        path.write_text(content, encoding='utf-8')
        return str(path)


class ReadDictionaryTest(DictionaryCsvTestCase):
    def test_reads_rows_with_explanation(self) -> None:
        path = self.write_csv(f'{HEADER}\nhet,boek,The book,I read the book.,het - rule\n')

        rows = upload.read_dictionary(path)

        self.assertEqual(rows, [{
            'article': 'het',
            'dutch': 'boek',
            'english': 'The book',
            'example': 'I read the book.',
            'explanation': 'het - rule',
        }])

    def test_reads_quoted_explanation_with_commas(self) -> None:
        path = self.write_csv(f'{HEADER}\nhet,begin,The beginning,It is the beginning.,"het - verbs, be-/ge-"\n')

        self.assertEqual(upload.read_dictionary(path)[0]['explanation'], 'het - verbs, be-/ge-')

    def test_keeps_empty_explanation(self) -> None:
        path = self.write_csv(f'{HEADER}\nde,tafel,The table,The table is big.,\n')

        self.assertEqual(upload.read_dictionary(path)[0]['explanation'], '')

    def test_accepts_columns_in_any_order_and_ignores_extra_ones(self) -> None:
        path = self.write_csv('explanation,extra,example,english,dutch,article\nrule,x,Ex.,The table,tafel,de\n')

        self.assertEqual(upload.read_dictionary(path), [{
            'article': 'de',
            'dutch': 'tafel',
            'english': 'The table',
            'example': 'Ex.',
            'explanation': 'rule',
        }])

    def test_returns_no_rows_for_header_only(self) -> None:
        self.assertEqual(upload.read_dictionary(self.write_csv(f'{HEADER}\n')), [])

    def test_fails_on_old_format_without_explanation(self) -> None:
        path = self.write_csv('article,dutch,english,example\nde,tafel,The table,The table is big.\n')

        with self.assertRaisesRegex(upload.DictionaryFormatError, 'old dictionary format'):
            upload.read_dictionary(path)

    def test_fails_on_empty_file(self) -> None:
        with self.assertRaisesRegex(upload.DictionaryFormatError, 'old dictionary format'):
            upload.read_dictionary(self.write_csv(''))

    def test_fails_on_missing_other_columns(self) -> None:
        path = self.write_csv('article,dutch,explanation\nde,tafel,rule\n')

        with self.assertRaisesRegex(upload.DictionaryFormatError, 'missing columns: english, example'):
            upload.read_dictionary(path)


class UploadToFirestoreTest(DictionaryCsvTestCase):
    def setUp(self) -> None:
        super().setUp()
        fake_firestore.Client.reset_mock()
        self.collection_ref = fake_firestore.Client.return_value.collection.return_value

    def test_uploads_rows_with_explanation(self) -> None:
        path = self.write_csv(f'{HEADER}\nhet,boek,The book,I read the book.,rule 1\nde,tafel,The table,Big.,rule 2\n')

        upload.upload_to_firestore('project', 'database', 'dictionary', path)

        fake_firestore.Client.assert_called_once_with(project='project', database='database')
        fake_firestore.Client.return_value.collection.assert_called_once_with('dictionary')
        documents = [call.args[0] for call in self.collection_ref.add.call_args_list]
        self.assertEqual([document['id'] for document in documents], [1, 2])
        self.assertEqual([document['explanation'] for document in documents], ['rule 1', 'rule 2'])
        self.assertEqual(documents[0]['dutch'], 'boek')
        for document in documents:
            self.assertTrue(0 <= document['random_key'] < 1)
            self.assertIn('import_timestamp', document)
            self.assertEqual(document['statistics'], {'correct': 0, 'incorrect': 0})
            self.assertIsNone(document['difficulty'])

    def test_creates_separate_statistics_per_document(self) -> None:
        path = self.write_csv(f'{HEADER}\nhet,boek,The book,Ex.,rule\nde,tafel,The table,Ex.,rule\n')

        upload.upload_to_firestore('project', 'database', 'dictionary', path)

        first, second = (call.args[0] for call in self.collection_ref.add.call_args_list)
        self.assertIsNot(first['statistics'], second['statistics'])

    def test_does_not_connect_to_firestore_for_old_format(self) -> None:
        path = self.write_csv('article,dutch,english,example\nde,tafel,The table,Big.\n')

        with self.assertRaises(upload.DictionaryFormatError):
            upload.upload_to_firestore('project', 'database', 'dictionary', path)

        fake_firestore.Client.assert_not_called()


if __name__ == '__main__':
    unittest.main()
