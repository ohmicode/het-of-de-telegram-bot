
import csv
import random
import argparse
from datetime import datetime
from google.cloud import firestore

def upload_to_firestore(project_id, database_name, collection_name, csv_file_path):
    """
    Uploads data from a CSV file to a Google Cloud Firestore collection.

    :param project_id: Google Cloud project ID.
    :param database_name: The name of the Firestore database.
    :param collection_name: The name of the Firestore collection.
    :param csv_file_path: The path to the CSV file.
    """
    db = firestore.Client(project=project_id, database=database_name)
    collection_ref = db.collection(collection_name)

    with open(csv_file_path, mode='r', encoding='utf-8') as csvfile:
        reader = csv.reader(csvfile)
        next(reader)  # Skip header row

        for i, row in enumerate(reader):
            article, dutch, english, example = row
            doc_data = {
                'id': i + 1,
                'article': article,
                'dutch': dutch,
                'english': english,
                'example': example,
                'import_timestamp': datetime.now(),
                'random_key': random.random()
            }
            collection_ref.add(doc_data)
            print(f"Uploaded: {doc_data}")

    print("Upload complete.")

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Upload a CSV file to Google Cloud Firestore.')
    parser.add_argument('--project_id', required=True, help='Google Cloud project ID.')
    parser.add_argument('--database', required=True, help='The name of the Firestore database.')
    parser.add_argument('--collection', required=True, help='The name of the Firestore collection.')
    parser.add_argument('--csv_file', required=True, help='The path to the CSV file.')

    args = parser.parse_args()

    upload_to_firestore(args.project_id, args.database, args.collection, args.csv_file)
