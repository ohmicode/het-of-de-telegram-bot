import csv
import random
import argparse
import sys
from datetime import datetime
from typing import Final

from google.cloud import firestore

REQUIRED_COLUMNS: Final = ('article', 'dutch', 'english', 'example', 'explanation')


class DictionaryFormatError(Exception):
    """Raised when the source CSV does not match the expected dictionary format."""


def read_dictionary(csv_file_path: str) -> list[dict[str, str]]:
    """
    Reads and validates dictionary rows from a CSV file.

    :param csv_file_path: The path to the CSV file.
    :return: Rows with the required columns only.
    :raises DictionaryFormatError: If required columns are missing in the CSV header.
    """
    with open(csv_file_path, mode='r', encoding='utf-8', newline='') as csvfile:
        reader = csv.DictReader(csvfile)
        header = reader.fieldnames or []

        if 'explanation' not in header:
            raise DictionaryFormatError(
                f"{csv_file_path}: no 'explanation' column found. "
                f"You're using an old dictionary format; expected columns: {','.join(REQUIRED_COLUMNS)}"
            )
        missing_columns = [column for column in REQUIRED_COLUMNS if column not in header]
        if missing_columns:
            raise DictionaryFormatError(f"{csv_file_path}: missing columns: {', '.join(missing_columns)}")

        return [{column: row[column] for column in REQUIRED_COLUMNS} for row in reader]


def upload_to_firestore(project_id: str, database_name: str, collection_name: str, csv_file_path: str) -> None:
    """
    Uploads data from a CSV file to a Google Cloud Firestore collection.

    :param project_id: Google Cloud project ID.
    :param database_name: The name of the Firestore database.
    :param collection_name: The name of the Firestore collection.
    :param csv_file_path: The path to the CSV file.
    :raises DictionaryFormatError: If the CSV file has an unsupported format.
    """
    rows = read_dictionary(csv_file_path)

    db = firestore.Client(project=project_id, database=database_name)
    collection_ref = db.collection(collection_name)

    for i, row in enumerate(rows):
        doc_data = {
            'id': i + 1,
            **row,
            'statistics': {'correct': 0, 'incorrect': 0},
            'difficulty': None,
            'import_timestamp': datetime.now(),
            'random_key': random.random(),
        }
        collection_ref.add(doc_data)
        print(f'Uploaded: {doc_data}')

    print('Upload complete.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Upload a CSV file to Google Cloud Firestore.')
    parser.add_argument('--project_id', required=True, help='Google Cloud project ID.')
    parser.add_argument('--database', required=True, help='The name of the Firestore database.')
    parser.add_argument('--collection', required=True, help='The name of the Firestore collection.')
    parser.add_argument('--csv_file', required=True, help='The path to the CSV file.')

    args = parser.parse_args()

    try:
        upload_to_firestore(args.project_id, args.database, args.collection, args.csv_file)
    except DictionaryFormatError as error:
        print(f'Error: {error}', file=sys.stderr)
        sys.exit(1)
