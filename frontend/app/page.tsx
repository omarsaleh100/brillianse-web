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
  
  // --- Question Flow State ---
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
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        setShowLoginModal(false);
      } else {
        resetQuestionState();
      }
    });
    return () => unsubscribe();
  }, []); 

  // --- 2. Check if user has already played today ---
  // --- 2. Check if user has already played or was blocked ---
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

        // --- PRIORITY 1: Check if profile is incomplete ---
        // This must be the *first* check for any logged-in user.
        if (!userData.isProfileComplete) {
          router.push('/profile');
          return; // Send them to profile regardless of group status
        }

        // --- PRIORITY 2: Check if user was blocked today ---
        if (userData.groupFull && userData.groupFull.date === today) {
          setShowGroupFullModal(true); // Show the "group full" modal
          setIsCheckingUser(false);    // Stop loading
          return;                     // Stop processing
        }
        
        // --- PRIORITY 3: Check if user is already in a group ---
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
            setError('tryna fix something, will be back...'); // <-- CHANGED
          }
        } else {
          setError('tryna fix something, will be back...'); // <-- CHANGED
        }
      } catch (err) {
        console.error(err);
        setError('tryna fix something, will be back...'); // <-- CHANGED
      } finally {
        setIsFetchingQuestions(false);
      }
    };
    fetchQuestions();
  }, [isCheckingUser]);

  // This hook adds/removes a class to the <body> tag to disable scrolling
  useEffect(() => {
    // On mount, add the class
    document.body.classList.add('no-scroll');

    // On unmount (when user navigates away), remove the class
    return () => {
      document.body.classList.remove('no-scroll');
    };
  }, []);

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
        // If user is logged in, attempt to assign them
        const status = await assignUserToGroup(user, finalGroupId, newAnswers); // <-- MODIFIED
        
        if (status === 'full') { // <-- ADD THIS BLOCK
          setShowGroupFullModal(true);
        } else if (status === 'success') {
          // Check profile complete and redirect
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
    if (isSigningUp && password !== confirmPassword) {
      setAuthError('Passwords do not match. Please try again.');
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
      
      // --- NEW, CRITICAL PRE-JOIN CHECK ---
      const userSnap = await getDoc(userRef);
      let userData = userSnap.exists() ? userSnap.data() : null;

      if (userData) {
        // 1. Check if they are already blocked for the day
        if (userData.groupFull && userData.groupFull.date === today) {
          console.log("User already marked as 'groupFull' for today. Blocking join.");
          setShowAuthForm(false);
          setShowGroupFullModal(true); // Show the "group full" modal
          return; // STOP HERE. Do not assign to the new group.
        }
        // 2. Check if they are already in a group for the day (edge case)
        if (userData.dailyGroup && userData.dailyGroup.date === today) {
          console.log("User already in a group for today. Redirecting.");
          setShowAuthForm(false); 
          // The onAuthStateChanged listener and useEffect 2 will handle the redirect.
          return; 
        }
      }
      // --- END OF PRE-JOIN CHECK ---

      // If this is a new user, create their doc stub
      if (isSigningUp) {
        await setDoc(userRef, {
          email: loggedInUser.email,
          isProfileComplete: false,
          username: loggedInUser.email?.split('@')[0] || `user${Date.now()}`
        }, { merge: true });
        const newUserSnap = await getDoc(userRef);
        userData = newUserSnap.data() || null; 
      }

      // If they passed all checks, proceed with assigning them to the *new* group.
      if (groupId) {
        // This 'status' check is now a safety net for race conditions.
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
        // Should not happen in this flow, but good to have.
        router.refresh(); 
      }
    } catch (err: any) {
      console.error("Auth error:", err);
      // Check for specific Firebase auth error codes
      if (err.code === 'auth/email-already-in-use') {
        setAuthError('This email is already in use. Please try logging in.');
      } else if (err.code === 'auth/weak-password') {
        setAuthError('Password is too weak. It must be at least 6 characters.');
      } else if (err.code === 'auth/invalid-email') {
        setAuthError('Please enter a valid email address.');
      } else if (err.code === 'auth/invalid-credential') {
        setAuthError('Invalid email or password. Please try again.');
      } else {
        // A generic fallback for other errors
        setAuthError('An error occurred. Please try again.');
      }
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
      // The onAuthStateChanged listener will now handle the state reset.
    } catch (err) {
      console.error('Failed to sign out:', err);
      setError('Failed to sign out. Please try again.');
    }
  };

  // --- NEW: Handle Google Sign-in for the *Login Modal* ---
  const handleGoogleLogin = async () => {
    setAuthError(null);
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
      // onAuthStateChanged will handle closing the modal and redirecting
    } catch (err: any) {
      console.error("Google login error:", err);
      setAuthError("Failed to sign in with Google. Please try again.");
    }
  };

  // --- NEW: Handle Google Sign-in for the *Post-Quiz Form* ---
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
        // This is a new user, create their doc
        userData = {
          email: loggedInUser.email,
          isProfileComplete: false,
          username: loggedInUser.displayName || loggedInUser.email?.split('@')[0] || `user${Date.now()}`,
          profilePictureUrl: loggedInUser.photoURL || null,
        };
        await setDoc(userRef, userData, { merge: true });
      }

      // Pre-join checks (same as in handleAuth)
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

      // If checks pass, assign to the new group
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
      setAuthError("Failed to sign in with Google. Please try again.");
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
      if (err.code === 'auth/invalid-credential') {
        setAuthError('Invalid email or password. Please try again.');
      } else if (err.code === 'auth/invalid-email') {
        setAuthError('Please enter a valid email address.');
      } else {
        setAuthError('An error occurred. Please try again.');
      }
    }
  };

  const handleBack = () => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex(prev => prev - 1);
    }
  };

  // --- 7. Add user to group AND save to user doc ---
  const assignUserToGroup = async (
    currentUser: User, 
    finalGroupId: string,
    rawAnswers: { [key: number]: string }
  ): Promise<'success' | 'full'> => {
    if (!currentUser || !finalGroupId) return 'success';
    
    console.log(`Attempting to assign user ${currentUser.uid} to group ${finalGroupId}`);
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
          // --- GROUP IS FULL ---
          console.log(`Group ${finalGroupId} is full. User ${currentUser.uid} denied.`);
          // Mark the user as "blocked" for the day
          transaction.set(userRef, {
            groupFull: { date: today }
          }, { merge: true });
          return 'full';
        }

        // --- GROUP HAS SPACE ---
        const answersAsArray = questions.map((_, index) => rawAnswers[index]);
        const dailyGroupData = {
          date: today,
          groupId: finalGroupId,
          answers: answersAsArray
        };

        // Write to group
        transaction.set(groupRef, {
          members: arrayUnion(currentUser.uid)
        }, { merge: true });

        // Write to user (and remove any "full" flag)
        transaction.set(userRef, { 
          dailyGroup: dailyGroupData,
          groupFull: deleteField() // Clear any "full" flag
        }, { merge: true });
        
        return 'success';
      });

      return status; // 'success' or 'full'
      
    } catch (err) {
      console.error('Failed to assign group with transaction:', err);
      setError('There was an error joining your group. Please try again.');
      return 'success'; // Fail open
    }
  };

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
            setConfirmPassword(''); // <-- ADDED: Reset this field too
            setAuthMode('login');   // <-- CHANGED: Set modal to 'login' mode
            setShowAuthForm(true);
          }}>
            Sign In
          </button>
        </div>
      )}

      {/* --- Post-answer auth form --- */}
      {showAuthForm && (
        <div className="auth-container">
          
          {/* --- CONTENT NOW CHANGES BASED ON authMode --- */}

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
          {/* --- END OF DYNAMIC CONTENT --- */}

        </div>
      )}

      {/* --- "GROUP FULL" MODAL --- */}
      {showGroupFullModal && (
        <div className="sign-out-modal-overlay">
          <div className="sign-out-modal-content">
            <h2>Group Full</h2>
            <p>This group already has 10 members. Please check back tomorrow for a new set of questions!</p>
            <div className="modal-actions">
              {/* This button just logs them out. */}
              <button onClick={handleSignOut} className="btn-secondary">
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- Main Question Form --- */}
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