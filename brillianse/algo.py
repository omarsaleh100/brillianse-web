from django.shortcuts import render
from django.http import JsonResponse
import firebase_admin
from firebase_admin import credentials, firestore
import requests
import os
from openai import OpenAI
from datetime import datetime
from dotenv import load_dotenv

env_path =  os.getcwd() + "/.env"
load_dotenv(env_path)

# initializing the firebase SDK
cred = credentials.Certificate('firebase-key.json')
firebase_admin.initialize_app(cred)
db = firestore.client()

# integrating ai with the openai key
client = OpenAI(
    api_key=os.getenv("OPENAI_API_KEY"),
)

def generate_statements(articles):
    statements = []
    for article in enumerate(articles): 
        prompt = f"Create a random very short contriversial statement that is in agree or disagree format on the topic of the provided article . Dont reference the article in the statement. make it punchy and not too detailed. Make it as simple and to the point as possible. Make the statements discussion provoking and borderline offensive. Dont say agree or disagree just give me the statement: {article}"
        print(prompt)
        try:
            chat_completion = client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {"role": "system", "content": "you are a helpful assistant."},
                    {"role": "user", "content": prompt}
                ]
            )
            statement = chat_completion.choices[0].message.content
            print(f"generated statement: {statement}")
            statements.append(statement)
        except Exception as e:
            print(f"error generating statement: {e}")

    return statements

def fetch_news():
    news_api_url = 'https://newsapi.org/v2/top-headlines'
    params = {
        'apiKey': 'ad3f3920f67840e0a0598e7c09357e5f',
        'country': 'ca',
    }
    # print the full URL for debugging
    full_url = requests.Request('GET', news_api_url, params=params).prepare().url
    print(f"request URL: {full_url}")
    
    response = requests.get(news_api_url, params=params)
    if response.status_code != 200:
        print(f"error fetching news: {response.status_code}")
        print(response.json())
        return []
    
    articles = response.json().get('articles', [])
    print(f"fetched {len(articles)} articles.")

    three_articles = [article['description'] if article['description'] is not None else article["title"] for article in articles[:3]]

    
    return three_articles

# this function stores the statements in firestore
def store_statements(statements):
    today = datetime.now().strftime('%Y-%m-%d')
    doc_ref = db.collection('daily_statements').document(today)
    doc_ref.set({
        'statements': statements,
        'date': today
    })
    print(f"stored statements for {today}")

# function to assign users to their group
def assign_user_to_group(user_id, responses):
    # convert responses to binary
    group_index = ''.join(['1' if r == 'agree' else '0' for r in responses])
    group_number = int(group_index, 2) + 1
    group_name = ['Nova', 'Echo', 'Serenity', 'Mirage', 'Helios', 'Anubis', 'Saturn', 'Flora'][group_number - 1]
    group_ref = db.collection('groups').document(group_name)
    group_ref.set({'members': firebase_admin.firestore.ArrayUnion([user_id])}, merge=True)
    
    return group_name


if __name__ == "__main__":
    articles = fetch_news()
    statements = generate_statements(articles)
    if statements:
        store_statements(statements)
    
    # multiple fake users
    user_group1 = assign_user_to_group('user8', ['disagree', 'disagree', 'disagree'])
    user_group2 = assign_user_to_group('user9', ['agree', 'disagree', 'agree'])
    user_group3 = assign_user_to_group('user10', ['agree', 'agree', 'disagree'])
    