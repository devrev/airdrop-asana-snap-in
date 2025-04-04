import os
import requests
import random
import time
from dotenv import load_dotenv
from datetime import datetime, timedelta  # Ensure correct import

# Load environment variables from .env file
load_dotenv()

# Get access token and project ID from environment variables
ACCESS_TOKEN = os.getenv('ACCESS_TOKEN')
PROJECT_ID = os.getenv('PROJECT_ID')

HEADERS = {
    'Authorization': f'Bearer {ACCESS_TOKEN}',
    'Content-Type': 'application/json',
}

def create_task(session, task_name, notes, due_date, completed):
    url = 'https://app.asana.com/api/1.0/tasks'
    data = {
        'data': {
            'name': task_name,
            'projects': [PROJECT_ID],
            'notes': notes,
            'due_on': due_date,  # Use ISO 8601 format (YYYY-MM-DD)
            'completed': completed,  # Randomly completed or not
        },
    }

    try:
        response = session.post(url, json=data)
        if response.status_code == 201:
            print(f"Task '{task_name}' created successfully.")
            return True
        elif response.status_code == 429:
            retry_after = int(response.headers.get('Retry-After', 10))  # Use a default value if header is absent
            print(f"Rate limit hit. Retrying after {retry_after} seconds...")
            time.sleep(retry_after)
            return False
        else:
            print(f"Failed to create task '{task_name}'. Status code: {response.status_code}, Response: {response.json()}")
    except requests.exceptions.RequestException as e:
        print(f"Request failed: {e}. Retrying...")
        return True

    print(f"Something went wrong. Skipping task '{task_name}'.")
    return True

def generate_random_due_date():
    today = datetime.utcnow()
    random_days = random.randint(1, 60)  # Up to two months into the future
    random_due_date = today + timedelta(days=random_days)
    return random_due_date.strftime('%Y-%m-%d')

def main():
    if not ACCESS_TOKEN or not PROJECT_ID:
        print("ACCESS_TOKEN and PROJECT_ID must be set in the .env file.")
        return

    start_time = time.time()  # Record the start time
        
    with requests.Session() as session:
        session.headers.update(HEADERS)
        
        for i in range(1,1001):
            task_name = f'Task {i}'
            notes = f"These are detailed notes for {task_name}."
            due_date = generate_random_due_date()  # Get a random due date
            completed = random.choice([True, False])  # Randomly set as completed or not

            while not create_task(session, task_name, notes, due_date, completed):
                time.sleep(1)  # Short delay before retrying for other errors
            
            time.sleep(0.1)  # Regular throttling delay

    end_time = time.time()  # Record the end time

    total_time = end_time - start_time
    print(f"Total time taken to generate tasks: {total_time:.2f} seconds")

if __name__ == '__main__':
    main()