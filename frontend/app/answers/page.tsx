'use client';

import { useState, useEffect } from 'react';
import Head from 'next/head';
import { db, auth } from '../../lib/firebase';
import { doc, getDoc, DocumentData } from 'firebase/firestore';
import { onAuthStateChanged, User } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

type UserData = {
  dailyGroup?: {
    groupId: string;
    answers: string[];
  };
};

export default function AnswersPage() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [questions, setQuestions] = useState<string[]>([]);
  const [answers, setAnswers] = useState<string[]>([]);
  const [groupId, setGroupId] = useState<string | null>(null);
  
  const router = useRouter();

  // --- 1. Listen for auth state ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (!currentUser) {
        router.push('/');
      }
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, [router]);

  // --- 2. Fetch Questions and User's Answers ---
  useEffect(() => {
    if (!user) return;

    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);

        // Fetch user data to get answers and group ID
        const userRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);
        
        if (!userSnap.exists() || !userSnap.data().dailyGroup) {
          throw new Error('You have not answered today\'s questions yet.');
        }
        
        const userData = userSnap.data() as UserData;
        const dailyAnswers = userData.dailyGroup?.answers || [];
        const dailyGroupId = userData.dailyGroup?.groupId || null;
        
        setAnswers(dailyAnswers);
        setGroupId(dailyGroupId);

        // Fetch daily questions to display
        const configRef = doc(db, 'config', 'daily');
        const configSnap = await getDoc(configRef);
        
        if (!configSnap.exists()) {
          throw new Error('Could not load daily questions.');
        }

        const configData = configSnap.data();
        setQuestions(configData.questions || []);

      } catch (err: any) {
        console.error(err);
        setError(err.message || 'Failed to load your answers.');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [user]);

  // --- RENDER LOGIC ---

  if (loading) {
    return <main className="loading-container">Loading your answers...</main>;
  }

  if (error) {
    return <main className="error-container">{error}</main>;
  }

  return (
    <main>
      <Head>
        <title>My Daily Answers</title>
      </Head>
      <div className="profile-content-wrapper">
        {groupId && (
          <div className="page-nav-header">
            <Link href={`/group/${groupId}`}>
              &larr; 
            </Link>
          </div>
        )}

        <div className="profile-form">
          <h1>Your Answers</h1>
          <p>These are the answers you submitted today.</p>
          
          <div className="answers-list">
            {questions.map((question, index) => (
              <div 
                key={index} 
                // --- MODIFICATION: Added dynamic classes based on the answer ---
                className={`answer-item ${answers[index] === 'yes' ? 'answered-yes' : 'answered-no'}`}
              >
                <p className="question-text">{index + 1}. {question}</p>
                <span className={`answer-tag ${answers[index] === 'yes' ? 'yes' : 'no'}`}>
                  {answers[index] || 'No Answer'}
                </span>
              </div>
            ))}
          </div>
        
      </div>
      <div className="profile-nav-wrapper">
          {groupId && (
            <div className="page-nav-header" style={{ visibility: 'hidden' }}>
              <Link href={`/group/${groupId}`}>
                &larr;
              </Link>
            </div>
          )}
        </div>
        
      </div> 
    </main>
  );
}