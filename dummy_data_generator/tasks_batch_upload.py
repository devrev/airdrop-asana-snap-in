import os
import requests
import random
import time
from dotenv import load_dotenv
from datetime import datetime, timedelta

# Load environment variables from .env file
load_dotenv()

# Get access token and project ID from environment variables
ACCESS_TOKEN = os.getenv('ACCESS_TOKEN')
PROJECT_ID = os.getenv('PROJECT_ID')

HEADERS = {
    'Authorization': f'Bearer {ACCESS_TOKEN}',
    'Content-Type': 'application/json',
}

def create_batch_tasks(session, tasks):
    url = 'https://app.asana.com/api/1.0/batch'
    data = {
        'data': {
            'actions': [{
                'method': 'post',
                'relative_path': '/tasks',
                'data': task
            } for task in tasks]
        }
    }
    
    try:
        response = session.post(url, json=data)
        if response.status_code in [200, 201]:
            print("Batch of tasks created successfully.")
            return True
        elif response.status_code == 429:
            # With batch request, handle 429 for the entire batch
            retry_after = int(response.headers.get('Retry-After', 10))
            print(f"Rate limit hit. Retrying after {retry_after} seconds...")
            time.sleep(retry_after)
            return False
        else:
            # Log error for failed requests
            print(f"Failed to create batch of tasks. Status code: {response.status_code}, Response: {response.json()}")
    except requests.exceptions.RequestException as e:
        print(f"Request failed: {e}. Skipping...")
        return True

    return True

def generate_task_data(i):
    return {
        'name': f'Task {i}',
        'projects': [PROJECT_ID],
        'notes': f"These are detailed notes for Task {i}.",
        'due_on': generate_random_due_date(),
        'completed': random.choice([True, False]),
    }

def generate_random_due_date():
    today = datetime.utcnow()
    random_days = random.randint(1, 60)
    random_due_date = today + timedelta(days=random_days)
    return random_due_date.strftime('%Y-%m-%d')

def main():
    if not ACCESS_TOKEN or not PROJECT_ID:
        print("ACCESS_TOKEN and PROJECT_ID must be set in the .env file.")
        return
    
    start_time = time.time()  # Record the start time
    
    with requests.Session() as session:
        session.headers.update(HEADERS)

        for i in range(1, 1000, 10):
            tasks = [generate_task_data(j) for j in range(i, min(i + 10, 1000))]
            while not create_batch_tasks(session, tasks):
                time.sleep(1)  # Short delay before retrying for other errors
            time.sleep(0.1)  # Regular throttling delay between batches
    
    end_time = time.time()  # Record the end time
    total_time = end_time - start_time
    print(f"Total time taken to generate tasks: {total_time:.2f} seconds")

if __name__ == '__main__':
    main()