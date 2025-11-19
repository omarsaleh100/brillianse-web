'use client';

import { useState, useEffect } from 'react';
import Head from 'next/head';
import { db, auth } from '../lib/firebase';
import { doc, getDoc, setDoc, arrayUnion, runTransaction, deleteField } from 'firebase/firestore';
import {
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  User,
  signOut,
  sendEmailVerification,
  signInWithPopup,
  GoogleAuthProvider
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
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showAuthForm, setShowAuthForm] = useState(false);
  const [authMode, setAuthMode] = useState<'signup' | 'login'>('signup');
  const [authError, setAuthError] = useState<string | null>(null);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showGroupFullModal, setShowGroupFullModal] = useState(false);
  
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  
  const router = useRouter();

  const resetQuestionState = () => {
    setAnswers({});
    setCurrentQuestionIndex(0);
    setGroupId(null);
    setShowAuthForm(false);
    setShowGroupFullModal(false);
    setError(null);
    setAuthError(null);
    setConfirmPassword('');
    setAuthMode('signup');
  };

  // --- 1. Listen for user auth changes ---
  // --- 1. Listen for user auth changes ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      
      // If no user is found, we are done checking. 
      // If a user IS found, the "Check if user has already played" effect will handle the loading state.
      if (!currentUser) {
        setIsCheckingUser(false);
      }
    });

    // Cleanup subscription on unmount
    return () => unsubscribe();
  }, []);

  // --- 1.5 Handle Body Scroll (Separate Effect) ---
  useEffect(() => {
    if (showAuthForm) {
      document.body.classList.remove('no-scroll');
    } else {
      document.body.classList.add('no-scroll');
    }
    return () => document.body.classList.remove('no-scroll');
  }, [showAuthForm]);

  // --- 2. Check if user has already played ---
  useEffect(() => {
    const checkUserStatus = async () => {
      // If no user, stop checking user status
      if (!user) {
        setIsCheckingUser(false);
        return;
      }
      const userRef = doc(db, 'users', user.uid);
      const userSnap = await getDoc(userRef);
      const today = getTodayDate();

      if (userSnap.exists()) {
        const userData = userSnap.data();

        if (!userData.isProfileComplete) {
          router.push('/profile');
          return; 
        }

        if (userData.groupFull && userData.groupFull.date === today) {
          setShowGroupFullModal(true); 
          setIsCheckingUser(false);    
          return;                     
        }
        
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
    // Only fetch after we've confirmed user status
    if (isCheckingUser) return;

    const fetchQuestions = async () => {
      try {
        setIsFetchingQuestions(true);
        const docRef = doc(db, 'config', 'daily');
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
          const data = docSnap.data();
          // Check if the date matches today
          if (data.date === getTodayDate()) {
            setQuestions(data.questions || []);
            setCurrentQuestionIndex(0); 
          } else {
            // Data exists but it's old
            setError('Questions for today are not ready yet. Check back soon!');
          }
        } else {
          // Document doesn't exist at all
          setError('Questions for today are not ready yet. Check back soon!');
        }
      } catch (err) {
        console.error(err);
        setError('Failed to load questions. Please try refreshing.');
      } finally {
        setIsFetchingQuestions(false);
      }
    };
    fetchQuestions();
  }, [isCheckingUser]);

  useEffect(() => {
    document.body.classList.add('no-scroll');
    return () => {
      document.body.classList.remove('no-scroll');
    };
  }, []);

  const handleAnswer = async (questionIndex: number, answer: string) => {
    const newAnswers = { ...answers, [questionIndex]: answer };
    setAnswers(newAnswers);

    if (questionIndex === questions.length - 1) {
      const finalGroupId = questions.map((_, index) => newAnswers[index] === 'yes' ? '1' : '0').join('');
      setGroupId(finalGroupId);

      if (user) {
        const status = await assignUserToGroup(user, finalGroupId, newAnswers);
        if (status === 'full') {
          setShowGroupFullModal(true);
        } else if (status === 'success') {
          const userSnap = await getDoc(doc(db, 'users', user.uid));
          const userData = userSnap.data();
          setShowAuthForm(false);
          if (userData?.isProfileComplete) {
            router.push(`/group/${finalGroupId}`);
          } else {
            router.push(`/profile`);
          }
        }
      } else {
        setShowAuthForm(true);
      }
    } else {
      setCurrentQuestionIndex(prev => prev + 1);
    }
  };

  const handleAuth = async (isSigningUp: boolean) => {
    if (!email || !password) {
      setAuthError('Please enter email and password.');
      return;
    }
    if (isSigningUp && password !== confirmPassword) {
      setAuthError('Passwords do not match.');
      return;
    }
    setAuthError(null);
    try {
      let userCredential;
      if (isSigningUp) {
        userCredential = await createUserWithEmailAndPassword(auth, email, password);
        await sendEmailVerification(userCredential.user);
      } else {
        userCredential = await signInWithEmailAndPassword(auth, email, password);
      }
      
      const loggedInUser = userCredential.user;
      const today = getTodayDate();
      const userRef = doc(db, 'users', loggedInUser.uid);
      
      const userSnap = await getDoc(userRef);
      let userData = userSnap.exists() ? userSnap.data() : null;

      if (userData) {
        if (userData.groupFull && userData.groupFull.date === today) {
          setShowAuthForm(false);
          setShowGroupFullModal(true);
          return;
        }
        if (userData.dailyGroup && userData.dailyGroup.date === today) {
          setShowAuthForm(false); 
          return; 
        }
      }

      if (isSigningUp) {
        await setDoc(userRef, {
          email: loggedInUser.email,
          isProfileComplete: false,
          username: loggedInUser.email?.split('@')[0] || `user${Date.now()}`
        }, { merge: true });
        const newUserSnap = await getDoc(userRef);
        userData = newUserSnap.data() || null; 
      }

      if (groupId) {
        const status = await assignUserToGroup(loggedInUser, groupId, answers); 
        if (status === 'full') { 
          setShowAuthForm(false); 
          setShowGroupFullModal(true); 
        } else if (status === 'success') {
          setShowAuthForm(false);
          if (userData?.isProfileComplete) {
            router.push(`/group/${groupId}`);
          } else {
            router.push(`/profile`);
          }
        }
      } else {
        router.refresh(); 
      }
    } catch (err: any) {
      console.error("Auth error:", err);
      if (err.code === 'auth/email-already-in-use') {
        setAuthError('This email is already in use.');
      } else if (err.code === 'auth/weak-password') {
        setAuthError('Password must be at least 6 characters.');
      } else if (err.code === 'auth/invalid-email') {
        setAuthError('Please enter a valid email address.');
      } else if (err.code === 'auth/invalid-credential') {
        setAuthError('Invalid email or password.');
      } else {
        setAuthError('An error occurred. Please try again.');
      }
    }
  };

  const handleGoogleJoin = async () => {
    setAuthError(null);
    const provider = new GoogleAuthProvider();
    try {
      const result = await signInWithPopup(auth, provider);
      const loggedInUser = result.user;
      const today = getTodayDate();
      const userRef = doc(db, 'users', loggedInUser.uid);
      
      const userSnap = await getDoc(userRef);
      let userData = userSnap.exists() ? userSnap.data() : null;

      if (!userSnap.exists()) {
        userData = {
          email: loggedInUser.email,
          isProfileComplete: false,
          username: loggedInUser.displayName || loggedInUser.email?.split('@')[0] || `user${Date.now()}`,
          profilePictureUrl: loggedInUser.photoURL || null,
        };
        await setDoc(userRef, userData, { merge: true });
      }

      if (userData) {
        if (userData.groupFull && userData.groupFull.date === today) {
          setShowAuthForm(false);
          setShowGroupFullModal(true);
          return;
        }
        if (userData.dailyGroup && userData.dailyGroup.date === today) {
          router.push(`/group/${userData.dailyGroup.groupId}`);
          return;
        }
      }

      if (groupId) {
        const status = await assignUserToGroup(loggedInUser, groupId, answers);
        if (status === 'full') {
          setShowAuthForm(false);
          setShowGroupFullModal(true);
        } else if (status === 'success') {
          setShowAuthForm(false);
          if (userData?.isProfileComplete) {
            router.push(`/group/${groupId}`);
          } else {
            router.push(`/profile`);
          }
        }
      } else {
        router.refresh();
      }

    } catch (err: any) {
      console.error("Google join error:", err);
      setAuthError("Failed to sign in with Google.");
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
    } catch (err) {
      console.error('Failed to sign out:', err);
      setError('Failed to sign out.');
    }
  };

  const handleBack = () => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex(prev => prev - 1);
    }
  };

  const assignUserToGroup = async (
    currentUser: User, 
    finalGroupId: string,
    rawAnswers: { [key: number]: string }
  ): Promise<'success' | 'full'> => {
    if (!currentUser || !finalGroupId) return 'success';
    const today = getTodayDate();
    const userRef = doc(db, 'users', currentUser.uid);

    try {
      const status = await runTransaction(db, async (transaction) => {
        const groupRef = doc(db, `daily_groups/${today}/groups`, finalGroupId);
        const groupSnap = await transaction.get(groupRef);
        
        let members: string[] = [];
        if (groupSnap.exists()) {
          members = groupSnap.data().members || [];
        }

        if (members.length >= 10 && !members.includes(currentUser.uid)) {
          transaction.set(userRef, {
            groupFull: { date: today }
          }, { merge: true });
          return 'full';
        }

        const answersAsArray = questions.map((_, index) => rawAnswers[index]);
        const dailyGroupData = {
          date: today,
          groupId: finalGroupId,
          answers: answersAsArray
        };

        transaction.set(groupRef, {
          members: arrayUnion(currentUser.uid)
        }, { merge: true });

        transaction.set(userRef, { 
          dailyGroup: dailyGroupData,
          groupFull: deleteField()
        }, { merge: true });
        
        return 'success';
      });

      return status;
      
    } catch (err) {
      console.error('Failed to assign group with transaction:', err);
      setError('Error joining group. Please try again.');
      return 'success';
    }
  };

  // --- LOADING STATE (RENDER THIS IF FETCHING) ---
  if (isCheckingUser || isFetchingQuestions) {
    return (
      <main className="loading-container">
        {/* This will appear inside the fadeInPage animation */}
        <p>Loading today's questions...</p>
      </main>
    );
  }

  return (
    <main>
      <Head>
        <title>Brillianse - Daily Questions</title>
      </Head>

      {/* Sign In Button */}
      {!user && !showAuthForm && (
        <div className="header-actions">
          <button className="btn-sign-in-header" onClick={() => {
            setAuthError(null);
            setEmail('');
            setPassword('');
            setShowLoginModal(true);
            setConfirmPassword('');
            setAuthMode('login');
            setShowAuthForm(true);
          }}>
            Sign In
          </button>
        </div>
      )}

      {/* Post-answer Auth Form */}
      {showAuthForm && (
        <div className="auth-container">
          {authMode === 'signup' ? (
            <>
              <h2>You're in Group {groupId}!</h2>
              <p>Sign up to see your group members.</p>
              <div className="auth-form">
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" />
                <input 
                  type="password" 
                  value={confirmPassword} 
                  onChange={(e) => setConfirmPassword(e.target.value)} 
                  placeholder="Confirm Password" 
                />
                <button onClick={handleGoogleJoin} className="btn-google">
                  Continue with Google
                </button>
                <button onClick={() => handleAuth(true)} className="btn-primary">Sign Up</button>
                {authError && <p className="auth-error">{authError}</p>}
              </div>
              <p className="auth-toggle-link">
                Already have an account? <span onClick={() => { setAuthMode('login'); setAuthError(null); }}>Log In</span>
              </p>
            </>
          ) : (
            <>
              <h2>Log In</h2>
              <p>Log in to see your group members.</p>
              <div className="auth-form">
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" />
                <button onClick={handleGoogleJoin} className="btn-google">
                  Continue with Google
                </button>
                <button onClick={() => handleAuth(false)} className="btn-primary">Log In with Email</button>
                {authError && <p className="auth-error">{authError}</p>}
              </div>
              <p className="auth-toggle-link">
                Don't have an account? <span onClick={() => { setAuthMode('signup'); setAuthError(null); }}>Sign Up</span>
              </p>
            </>
          )}
        </div>
      )}

      {/* Group Full Modal */}
      {showGroupFullModal && (
        <div className="sign-out-modal-overlay">
          <div className="sign-out-modal-content">
            <h2>Group Full</h2>
            <p>This group already has 10 members. Please check back tomorrow!</p>
            <div className="modal-actions">
              <button onClick={handleSignOut} className="btn-secondary">
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- MAIN CONTENT LOGIC --- */}
      
      {/* 1. If we have an error (e.g. no questions) */}
      {error && (
        <div className="error-container">
          <h2>No Questions Yet</h2>
          <p>{error}</p>
          {/* Optional: Add a button to manual refresh if needed */}
          <button onClick={() => window.location.reload()} className="btn-secondary" style={{marginTop: '1rem'}}>
            Refresh
          </button>
        </div>
      )}

      {/* 2. If we have questions, show the quiz */}
      {questions.length > 0 && !showAuthForm && !error && (
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
            <div className="question-nav-header">
              {currentQuestionIndex > 0 && (
                <button onClick={handleBack} className="btn-back-question">
                  <img 
                    src="https://firebasestorage.googleapis.com/v0/b/brillianse-801f7.firebasestorage.app/o/Arrow%203%20(1).png?alt=media&token=543fa238-2ab7-4906-b2c3-8d5610d9119c" 
                    alt="Back" 
                  />
                </button>
              )}
            </div>
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