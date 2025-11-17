import firebase_admin
from firebase_admin import firestore
import os
import json
import google.generativeai as genai
from datetime import datetime
# No more 'requests' or 'random' imports

# Import Firebase Functions libraries
from firebase_functions import scheduler_fn
from firebase_admin import credentials

firebase_admin.initialize_app()

# set up the Gemini client
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)
else:
    print("FATAL: GEMINI_API_KEY secret not set.")


def generate_five_questions():
    """Generates 5 'yes/no' questions based on recent news/topics."""
    
    if not GEMINI_API_KEY:
        print("Cannot generate questions, GEMINI_API_KEY is missing.")
        return None

    model = genai.GenerativeModel(
        model_name='gemini-2.5-flash-preview-09-2025',
        generation_config={"response_mime_type": "application/json"}
    )
    
    prompt = f"""
    Today is {datetime.now().strftime('%A, %B %d, %Y')} in Toronto, Canada.
    
    Find 5 completely distinct, newsworthy, and recent topics.
    Topics should be relevant to today's time, drawing from areas like 
    technology, global events, finance, culture, or sports.

    For each of the 5 topics you find, create one short, simple, polarizing 'Yes or No' 
    question for a networking app. The goal is to spark discussion.

    Return your answer as a single JSON object with a key "questions"
    which holds a list of the 5 question strings.
    """
    
    print(f"Generating 5 questions with Gemini (self-sourced topics)...")
    try:
        response = model.generate_content(prompt)
        content = response.text
        
        data = json.loads(content)
        statements = data.get("questions", [])
        
        if len(statements) == 5:
            print(f"Generated 5 statements: {statements}")
            return statements
        else:
            print(f"Error: Gemini did not return exactly 5 statements. Got: {statements}")
            return None

    except Exception as e:
        print(f"Error generating statements: {e}")
        return None

@scheduler_fn.on_schedule(
    schedule="0 12 * * *",
    timezone="America/New_York", 
    secrets=["GEMINI_API_KEY"]
)
def deploy_daily_questions(event: scheduler_fn.ScheduledEvent) -> None:
    """Generates 5 questions, saves them, and archives them."""
    print("Running deploy_daily_questions function...")
    db = firestore.client()
    
    questions = generate_five_questions()
    
    if not questions:
        print("No questions generated. Aborting.")
        return

    today_str = datetime.now().strftime('%Y-%m-%d')
    
    question_data = {
        'questions': questions,
        'date': today_str,
        'createdAt': firestore.SERVER_TIMESTAMP
    }

    # --- 1. Update the 'daily' doc for the frontend ---
    daily_ref = db.collection('config').document('daily')
    daily_ref.set(question_data)
    print(f"Successfully stored questions in 'config/daily'")

    # --- 2. Archive the questions ---
    archive_ref = db.collection('question_archive').document(today_str)
    archive_ref.set(question_data)
    print(f"Successfully archived questions in 'question_archive/{today_str}'")