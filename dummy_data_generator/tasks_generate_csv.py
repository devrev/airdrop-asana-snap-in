import os
import csv
import random
from datetime import datetime, timedelta

def generate_random_due_date():
    today = datetime.utcnow()
    random_days = random.randint(1, 60)
    random_due_date = today + timedelta(days=random_days)
    # Return in US date format: month/day/year
    return random_due_date.strftime('%m/%d/%Y')

def generate_tasks(filename, num_tasks):
    with open(filename, mode='w', newline='') as csvfile:
        fieldnames = ['Name', 'Description', 'Assignee', 'Due Date']
        writer = csv.DictWriter(csvfile, fieldnames=fieldnames)

        writer.writeheader()
        
        # Generate and write tasks to the CSV file
        for i in range(1, num_tasks + 1):
            task_name = f"Task {i}"
            description = f"These are detailed notes for {task_name}."
            assignee = ""
            due_date = generate_random_due_date()
            
            writer.writerow({
                'Name': task_name,
                'Description': description,
                'Assignee': assignee,
                'Due Date': due_date
            })

if __name__ == '__main__':
    generate_tasks('tasks1000.csv', 1000)  # Generate 1000 tasks