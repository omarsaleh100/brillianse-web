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

export default function Home() {
  const [questions, setQuestions] = useState<string[]>([]);
  const [answers, setAnswers] = useState<{ [key: number]: string }>({});
  
  // --- Source of Truth for the "Current" Game Date ---
  const [gameDate, setGameDate] = useState<string | null>(null);

  const [isLoading, setIsLoading] = useState(true); 
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

  // --- 1. Initialization: Fetch Game Config & Check User Status ---
  useEffect(() => {
    const init = async () => {
      setIsLoading(true);
      try {
        // A. Fetch the "Master" Game Configuration first
        const configRef = doc(db, 'config', 'daily');
        const configSnap = await getDoc(configRef);

        if (!configSnap.exists()) {
          throw new Error("Daily questions not found.");
        }

        const configData = configSnap.data();
        const activeDate = configData.date; // e.g., "2025-11-19"
        
        if (!activeDate) {
             throw new Error("Configuration is missing the date.");
        }

        setQuestions(configData.questions || []);
        setGameDate(activeDate);
        setCurrentQuestionIndex(0);

        // B. Handle User State
        const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
          setUser(currentUser);

          if (currentUser) {
            // Check user's specific data against the activeDate
            const userRef = doc(db, 'users', currentUser.uid);
            const userSnap = await getDoc(userRef);
            
            if (userSnap.exists()) {
              const userData = userSnap.data();

              // 1. Incomplete Profile -> Profile Page
              if (!userData.isProfileComplete) {
                router.push('/profile');
                return;
              }

              // 2. If User has a dailyGroup AND the date matches the Active Game Date
              // If the dates DON'T match, we fall through to show the questions (Lazy Reset)
              if (userData.dailyGroup && userData.dailyGroup.date === activeDate) {
                router.push(`/group/${userData.dailyGroup.groupId}`);
                return;
              }

              // 3. If User has groupFull for THIS Active Date
              if (userData.groupFull && userData.groupFull.date === activeDate) {
                setShowGroupFullModal(true);
                setIsLoading(false);
                return;
              }
            }
          }
          
          // If no user, OR user exists but hasn't played for *this specific activeDate*
          // we reveal the questions to let them play.
          setIsLoading(false);
        });

        return () => unsubscribe();
      } catch (err: any) {
        console.error(err);
        setError("Failed to load the game. Please try refreshing.");
        setIsLoading(false);
      }
    };

    init();
  }, [router]);

  // --- Scroll Lock Management ---
  useEffect(() => {
    if (showAuthForm) {
      document.body.classList.remove('no-scroll');
    } else {
      document.body.classList.add('no-scroll');
    }
    return () => document.body.classList.remove('no-scroll');
  }, [showAuthForm]);

  const handleAnswer = async (questionIndex: number, answer: string) => {
    const newAnswers = { ...answers, [questionIndex]: answer };
    setAnswers(newAnswers);

    if (questionIndex === questions.length - 1) {
      const finalGroupId = questions.map((_, index) => newAnswers[index] === 'yes' ? '1' : '0').join('');
      setGroupId(finalGroupId);

      if (user) {
        // If logged in, immediately assign to group using the ACTIVE gameDate
        const status = await assignUserToGroup(user, finalGroupId, newAnswers);
        if (status === 'full') {
          setShowGroupFullModal(true);
        } else if (status === 'success') {
          const userSnap = await getDoc(doc(db, 'users', user.uid));
          const userData = userSnap.data();
          if (userData?.isProfileComplete) {
            router.push(`/group/${finalGroupId}`);
          } else {
            router.push(`/profile`);
          }
        }
      } else {
        // If not logged in, show auth form
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
      const userRef = doc(db, 'users', loggedInUser.uid);
      
      // Create default doc if signing up
      if (isSigningUp) {
        await setDoc(userRef, {
          email: loggedInUser.email,
          isProfileComplete: false,
          username: loggedInUser.email?.split('@')[0] || `user${Date.now()}`
        }, { merge: true });
      }
      
      // Check if profile is complete
      const userSnap = await getDoc(userRef);
      const userData = userSnap.exists() ? userSnap.data() : null;

      // Note: We DO NOT check for existing groups here based on 'today'.
      // We proceed to assign them based on the answers they JUST provided.
      // This overwrites any old stale data they might have had.

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
        // Edge case fallback
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
      const userRef = doc(db, 'users', loggedInUser.uid);
      
      const userSnap = await getDoc(userRef);
      let userData = userSnap.exists() ? userSnap.data() : null;

      if (!userData) {
        userData = {
          email: loggedInUser.email,
          isProfileComplete: false,
          username: loggedInUser.displayName || loggedInUser.email?.split('@')[0] || `user${Date.now()}`,
          profilePictureUrl: loggedInUser.photoURL || null,
        };
        await setDoc(userRef, userData, { merge: true });
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
      window.location.reload();
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

  // --- Transaction to Assign Group (Uses gameDate) ---
  const assignUserToGroup = async (
    currentUser: User, 
    finalGroupId: string,
    rawAnswers: { [key: number]: string }
  ): Promise<'success' | 'full'> => {
    // Ensure we have the Game Date loaded
    if (!currentUser || !finalGroupId || !gameDate) {
        console.error("Missing data for assignment");
        return 'success';
    }
    
    const userRef = doc(db, 'users', currentUser.uid);

    try {
      const status = await runTransaction(db, async (transaction) => {
        const groupRef = doc(db, `daily_groups/${gameDate}/groups`, finalGroupId);
        const groupSnap = await transaction.get(groupRef);
        
        let members: string[] = [];
        if (groupSnap.exists()) {
          members = groupSnap.data().members || [];
        }

        if (members.length >= 10 && !members.includes(currentUser.uid)) {
          transaction.set(userRef, {
            groupFull: { date: gameDate }
          }, { merge: true });
          return 'full';
        }

        const answersAsArray = questions.map((_, index) => rawAnswers[index]);
        
        // Overwrite the dailyGroup with the NEW gameDate.
        // This effectively resets the user's status to the new day.
        const dailyGroupData = {
          date: gameDate,
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

  if (isLoading) {
    return (
      <main className="loading-container">
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
          {/* Close Button/Cancel for Auth Form */}
           <button onClick={() => setShowAuthForm(false)} className="btn-secondary" style={{marginTop:'1rem'}}>
             Cancel
           </button>
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

      {/* Main Content Logic */}
      
      {/* 1. Error State */}
      {error && (
        <div className="error-container">
          <h2>No Questions Yet</h2>
          <p>{error}</p>
          <button onClick={() => window.location.reload()} className="btn-secondary" style={{marginTop: '1rem'}}>
            Refresh
          </button>
        </div>
      )}

      {/* 2. Questions UI */}
      {questions.length > 0 && !showAuthForm && !error && !showGroupFullModal && (
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