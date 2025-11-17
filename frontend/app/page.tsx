'use client';

import { useState, useEffect } from 'react';
import Head from 'next/head';
import { db, auth } from '../lib/firebase';
import { doc, getDoc, setDoc, arrayUnion } from 'firebase/firestore';
import {
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  User
} from 'firebase/auth';
import { useRouter } from 'next/navigation';

function getTodayDate() {
  return new Date().toISOString().split('T')[0];
}

export default function Home() {
  const [questions, setQuestions] = useState<string[]>([]);
  const [answers, setAnswers] = useState<{ [key: number]: string }>({});
  
  const [isCheckingUser, setIsCheckingUser] = useState(true);
  const [isFetchingQuestions, setIsFetchingQuestions] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [user, setUser] = useState<User | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);
  
  // --- Auth State ---
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showAuthForm, setShowAuthForm] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [showLoginModal, setShowLoginModal] = useState(false);
  
  // --- Question Flow State ---
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  
  const router = useRouter();

  // --- 1. Listen for user auth changes ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        setShowLoginModal(false);
      }
    });
    return () => unsubscribe();
  }, []);

  // --- 2. Check if user has already played today ---
  useEffect(() => {
    const checkUserStatus = async () => {
      if (!user) {
        setIsCheckingUser(false);
        return;
      }
      const userRef = doc(db, 'users', user.uid);
      const userSnap = await getDoc(userRef);
      const today = getTodayDate();
      if (userSnap.exists()) {
        const userData = userSnap.data();
        if (userData.dailyGroup && userData.dailyGroup.date === today) {
          router.push(`/group/${userData.dailyGroup.groupId}`);
          return;
        }
      }
      setIsCheckingUser(false);
    };
    checkUserStatus();
  }, [user, router]);

  // --- 3. Fetch daily questions ---
  useEffect(() => {
    if (isCheckingUser) return;
    const fetchQuestions = async () => {
      try {
        setIsFetchingQuestions(true);
        const docRef = doc(db, 'config', 'daily');
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          if (data.date === getTodayDate()) {
            setQuestions(data.questions);
            setCurrentQuestionIndex(0); // Start at first question
          } else {
            setError('New questions are being generated. Please check back in a few minutes.');
          }
        } else {
          setError('Could not find daily questions. Please check back later.');
        }
      } catch (err) {
        console.error(err);
        setError('Failed to load questions.');
      } finally {
        setIsFetchingQuestions(false);
      }
    };
    fetchQuestions();
  }, [isCheckingUser]);

  // --- 4. Handle Answer Selection & Flow ---
  const handleAnswer = async (questionIndex: number, answer: string) => {
    // 1. Save the new answer
    const newAnswers = {
      ...answers,
      [questionIndex]: answer
    };
    setAnswers(newAnswers);

    // 2. Update progress bar
    const newProgress = ((questionIndex + 1) / questions.length) * 100;

    // 3. Check if we are on the last question
    if (questionIndex === questions.length - 1) {
      // --- This is the end of the quiz ---
      const finalGroupId = questions.map((_, index) => newAnswers[index] === 'yes' ? '1' : '0').join('');
      setGroupId(finalGroupId);

      if (user) {
        // If user is logged in, assign them to the group
        await assignUserToGroup(user, finalGroupId, newAnswers);
      } else {
        // If user is not logged in, show the auth form
        setShowAuthForm(true);
      }
    } else {
      // --- Move to the next question ---
      setCurrentQuestionIndex(prev => prev + 1);
    }
  };

  // --- 5. Handle auth *after* answering ---
  const handleAuth = async (isSigningUp: boolean) => {
    if (!email || !password) {
      setAuthError('Please enter email and password.');
      return;
    }
    setAuthError(null);
    try {
      let userCredential;
      if (isSigningUp) {
        userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const newUser = userCredential.user;
        const userRef = doc(db, 'users', newUser.uid);
        await setDoc(userRef, {
          email: newUser.email,
          isProfileComplete: false,
          username: newUser.email?.split('@')[0] || `user${Date.now()}`
        }, { merge: true });
      } else {
        userCredential = await signInWithEmailAndPassword(auth, email, password);
      }
      const loggedInUser = userCredential.user;
      
      if (groupId) {
        await assignUserToGroup(loggedInUser, groupId, answers);
      } else {
        router.refresh();
      }
    } catch (err: any) {
      console.error("Auth error:", err);
      setAuthError(err.message);
    }
  };
  
  // --- 6. Handle login *before* answering ---
  const handleLogin = async () => {
    if (!email || !password) {
      setAuthError('Please enter email and password.');
      return;
    }
    setAuthError(null);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      setEmail('');
      setPassword('');
    } catch (err: any) {
      console.error("Login error:", err);
      setAuthError(err.message);
    }
  };

  // --- 7. Add user to group AND save to user doc ---
  const assignUserToGroup = async (
    currentUser: User, 
    finalGroupId: string,
    rawAnswers: { [key: number]: string }
  ) => {
    if (!currentUser || !finalGroupId) return;
    console.log(`Assigning user ${currentUser.uid} to group ${finalGroupId}`);
    try {
      const today = getTodayDate();
      const groupRef = doc(db, `daily_groups/${today}/groups`, finalGroupId);
      await setDoc(groupRef, {
        members: arrayUnion(currentUser.uid)
      }, { merge: true });

      const userRef = doc(db, 'users', currentUser.uid);
      const answersAsArray = questions.map((_, index) => rawAnswers[index]);
      const dailyGroupData = {
        date: today,
        groupId: finalGroupId,
        answers: answersAsArray
      };
      const userSnap = await getDoc(userRef);
      const userData = userSnap.data();

      await setDoc(userRef, { 
        dailyGroup: dailyGroupData 
      }, { merge: true });
      
      setShowAuthForm(false);
      if (userData?.isProfileComplete) {
        router.push(`/group/${finalGroupId}`);
      } else {
        router.push(`/profile`);
      }
    } catch (err) {
      console.error('Failed to assign group:', err);
      setError('There was an error joining your group. Please try again.');
    }
  };

  // --- RENDER LOGIC ---
  if (isCheckingUser || (isFetchingQuestions && questions.length === 0)) {
    return <main className="loading-container">Loading...</main>;
  }
  
  if (error) {
    return <main className="error-container">{error}</main>;
  }

  // --- MODIFIED RENDER ---
  // We now have one main <main> return, and all other
  // UI states are rendered conditionally *inside* it.
  return (
    <main>
      <Head>
        <title>Brillianse - Daily Questions</title>
      </Head>

      {/* --- Sign In Button in Header --- */}
      {!user && !showAuthForm && (
        <div className="header-actions">
          <button className="btn-sign-in-header" onClick={() => {
            setAuthError(null);
            setEmail('');
            setPassword('');
            setShowLoginModal(true);
          }}>
            Sign In
          </button>
        </div>
      )}

      {/* --- Post-answer auth form --- */}
      {showAuthForm && (
        <div className="auth-container">
          <h2>You're in Group {groupId}!</h2>
          <p>Sign up or log in to see your group members.</p>
          <div className="auth-form">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" />
            <button onClick={() => handleAuth(true)} className="btn-primary">Sign Up</button>
            <button onClick={() => handleAuth(false)} className="btn-secondary">Log In</button>
            {authError && <p className="auth-error">{authError}</p>}
          </div>
        </div>
      )}

      {/* --- Login-only modal --- */}
      {showLoginModal && (
        <div className="login-modal-overlay">
          <div className="login-modal-content">
            <h2>Sign In</h2>
            <p>Sign in to your existing account.</p>
            <button className="btn-close-modal" onClick={() => setShowLoginModal(false)}>X</button>
            <div className="auth-form">
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" />
              <button onClick={handleLogin} className="btn-primary">Log In</button>
              {authError && <p className="auth-error">{authError}</p>}
            </div>
          </div>
        </div>
      )}

      {/* --- Main Question Form --- */}
      {/* This will now render correctly */}
      {questions.length > 0 && !showAuthForm && (
        <div className="question-form">
          
          <div className="progress-indicator">
          <div className="progress-dots-container">
              {questions.map((_, index) => (
                <div
                  key={index}
                  className={`
                    progress-dot 
                    ${index === currentQuestionIndex ? 'active' : ''}
                    ${index < currentQuestionIndex ? 'completed' : ''}
                  `}
                />
              ))}
            </div>
          </div>

          <div className="question-block">
            <p className="question-text">
              {questions[currentQuestionIndex]}
            </p>
            
            <div className="button-group">
              <button
                type="button"
                className={`btn-answer ${answers[currentQuestionIndex] === 'yes' ? 'selected' : ''}`}
                onClick={() => handleAnswer(currentQuestionIndex, 'yes')}
              >
                Yes
              </button>
              <button
                type="button"
                className={`btn-answer ${answers[currentQuestionIndex] === 'no' ? 'selected' : ''}`}
                onClick={() => handleAnswer(currentQuestionIndex, 'no')}
              >
                No
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}