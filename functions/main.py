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
    
    Find 5 completely distinct topics from areas like technology, global events, 
    finance, culture, or sports.

    For each topic, create one **extremely simple, short, and polarizing 'Yes or No' question** for a networking app.

    **Strict Rules:**
    1.  **Length:** Questions must be **10 words or less**.
    2.  **Simplicity:** Use simple, casual language. Avoid technical jargon or niche subjects.
    3.  **Goal:** The question must be a simple "Yes/No" binary to spark discussion.
    
    **Examples of GOOD, simple questions:**
    - "Is AI moving too fast?"
    - "Are electric cars overrated?"
    - "Should all jobs offer a 4-day work week?"
    - "Is space exploration a waste of money?"
    - "Are athletes paid too much?"

    **Examples of BAD, wordy questions:**
    - "Do you believe the recent advancements in quantum computing will disrupt cybersecurity protocols?"
    - "Should the federal government increase subsidies for renewable energy manufacturing?"

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