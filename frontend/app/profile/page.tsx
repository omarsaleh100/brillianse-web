'use client';

import { useState, useEffect } from 'react';
import Head from 'next/head';
import { db, auth, storage } from '../../lib/firebase'; // <-- Import storage
import { doc, getDoc, setDoc, collection, query, where, getDocs} from 'firebase/firestore';
import { onAuthStateChanged, User, signOut, sendEmailVerification } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { 
  ref, 
  uploadBytesResumable, 
  getDownloadURL 
} from 'firebase/storage';

const DEFAULT_AVATAR_URL = 'https://firebasestorage.googleapis.com/v0/b/brillianse-801f7.firebasestorage.app/o/logos%2FBrillianse%20(5)%20copy.png?alt=media&token=ecffd21e-dff9-4151-b57f-5515be4c87e7';

export default function Profile() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [isEmailVerified, setIsEmailVerified] = useState(true);
  const [verificationSent, setVerificationSent] = useState(false);

  const [form, setForm] = useState({
    username: '',
    twitter: '',
    linkedin: '',
    instagram: '',
  });
  
  const [dailyGroupId, setDailyGroupId] = useState<string | null>(null);
  
  const [profilePicUrl, setProfilePicUrl] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isProfileComplete, setIsProfileComplete] = useState(false);
  
  const router = useRouter();

  // --- 1. Listen for user and load profile ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        await currentUser.reload();
        setUser(currentUser);
        setIsEmailVerified(currentUser.emailVerified);

        const userRef = doc(db, 'users', currentUser.uid);
        const docSnap = await getDoc(userRef);
        
        if (docSnap.exists()) {
          const data = docSnap.data();
          setIsProfileComplete(data.isProfileComplete || false);

          let suggestedUsername = data.username || '';
          if (!data.isProfileComplete) {
            const name = currentUser.email?.split('@')[0].replace(/[^a-zA-Z0-9]/g, '') || 'user';
            suggestedUsername = `${name}${Math.floor(100 + Math.random() * 900)}`;
          }
          setForm({
            username: data.username || suggestedUsername,
            twitter: data.socials?.twitter || '',
            linkedin: data.socials?.linkedin || '',
            instagram: data.socials?.instagram || '',
          });
          setProfilePicUrl(data.profilePictureUrl || null);
          if (data.dailyGroup?.groupId) {
            setDailyGroupId(data.dailyGroup.groupId);
          }
        }
      } else {
        router.push('/');
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, [router]);

  useEffect(() => {
    if (!user || isEmailVerified) {
      return; // Don't run if no user or if already verified
    }

    // Set up an interval to check every 3 seconds
    const interval = setInterval(async () => {
      await user.reload(); // Get fresh data
      
      if (user.emailVerified) {
        setIsEmailVerified(true);
        clearInterval(interval); // Stop polling
      }
    }, 3000); // Check every 3 seconds

    // Clean up the interval when the component unmounts or state changes
    return () => clearInterval(interval);

  }, [user, isEmailVerified]);
  
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { id, value } = e.target;
    setForm(prev => ({ ...prev, [id]: value }));
  };
  
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setImageFile(file);
      setProfilePicUrl(URL.createObjectURL(file));
    }
  };

  // --- 2. Handle Save Profile ---
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    setError(null);
    setSuccessMessage(null);
    setValidationError(null);

    const { username, twitter, linkedin, instagram } = form;
    if (!username) {
      setValidationError('Username is required.');
      return;
    }
    if (!twitter && !linkedin && !instagram) {
      setValidationError('Please add at least one social media handle.');
      return;
    }

    try {
      // --- START OF UNIQUENESS CHECK ---
      const userRef = doc(db, 'users', user.uid);
      const userSnap = await getDoc(userRef);
      const oldUsername = userSnap.exists() ? userSnap.data().username : null;

      // Only check for uniqueness if the username has actually changed
      if (oldUsername !== username) {
        const q = query(collection(db, 'users'), where('username', '==', username));
        const querySnapshot = await getDocs(q);
        
        if (!querySnapshot.empty) {
          // A document already exists with this username
          setValidationError('Username is already taken. Please try again.');
          return; // Stop the save
        }
      }
      // --- END OF UNIQUENESS CHECK ---

      let finalProfilePicUrl = profilePicUrl; 

      if (imageFile) {
        setIsUploading(true);
        const storageRef = ref(storage, `profile_pictures/${user.uid}`);
        const uploadTask = uploadBytesResumable(storageRef, imageFile);

        await new Promise<void>((resolve, reject) => {
          uploadTask.on(
            'state_changed',
            (snapshot) => {
              const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
              setUploadProgress(progress);
            },
            (error) => {
              console.error('Upload failed:', error);
              setError('Image upload failed. Please try again.');
              reject(error);
            },
            async () => {
              const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
              finalProfilePicUrl = downloadURL;
              setIsUploading(false);
              setImageFile(null);
              resolve();
            }
          );
        });
      }
      
      await setDoc(userRef, {
        username: username,
        email: user.email,
        socials: {
          twitter: twitter,
          linkedin: linkedin,
          instagram: instagram,
        },
        profilePictureUrl: finalProfilePicUrl,
        isProfileComplete: true
      }, { merge: true });

      setSuccessMessage('Profile saved! Redirecting to your group...');

      setTimeout(() => {
        if (dailyGroupId) {
          router.push(`/group/${dailyGroupId}`);
        } else {
          router.push('/');
        }
      }, 2000);

    } catch (err) {
      if (!isUploading) {
        console.error(err);
        setError('Failed to save profile. Please try again.');
      }
    } finally {
      setIsUploading(false);
    }
  };

  const handleResendVerification = async () => {
    if (!user) return;
    try {
      await sendEmailVerification(user);
      setVerificationSent(true);
      // Hide the "sent" message after a few seconds
      setTimeout(() => setVerificationSent(false), 3000);
    } catch (err) {
      console.error("Failed to resend verification:", err);
    }
  };

  // --- 3. Handle Sign Out ---
  const handleSignOut = async () => {
    try {
      await signOut(auth);
    } catch (err) {
      console.error('Failed to sign out:', err);
    }
  };

  if (loading) {
    return <main className="loading-container">Loading profile...</main>;
  }

  return (
    <main> {/* This is the main flex-column container */}
      <Head>
        <title>My Profile</title>
      </Head>

      {/* --- NEW: Wrapper for side-by-side layout --- */}
      <div className="profile-content-wrapper">

        {/* --- MODIFIED: Wrapper for the button --- */}
        <div className="profile-nav-wrapper">
          {dailyGroupId && isProfileComplete && (
            <div className="page-nav-header">
              <Link href={`/group/${dailyGroupId}`}>
                &larr;
              </Link>
            </div>
          )}
        </div>
        {/* ---------------------------- */}

        <form onSubmit={handleSave} className="profile-form">
          <h1>Your Profile</h1>
          <p>This is what other users in your group will see.</p>

          {successMessage && <div className="success-message">{successMessage}</div>}
          {error && <div className="error-container">{error}</div>}
          {validationError && <div className="validation-error">{validationError}</div>}

          {!isEmailVerified && (
            <div className="verification-notice">
              <p>Please check your email to verify your account.</p>
              <button onClick={handleResendVerification} disabled={verificationSent}>
                {verificationSent ? 'Sent!' : 'Resend Email'}
              </button>
            </div>
          )}

          <div className="pfp-uploader">
            <label htmlFor="file-input">
              <img 
                src={profilePicUrl || DEFAULT_AVATAR_URL} 
                alt="Profile" 
                className="pfp-preview"
                onError={(e) => (e.currentTarget.src = DEFAULT_AVATAR_URL)}/>
              <span className="pfp-edit-text">Click to change</span>
            </label>
            <input 
              id="file-input" 
              type="file" 
              accept="image/png, image/jpeg"
              onChange={handleFileChange}
            />
          </div>
          
          {isUploading && (
            <div className="upload-progress-bar">
              <div style={{ width: `${uploadProgress}%` }}></div>
            </div>
          )}

          <div className="input-group">
            <label htmlFor="username">Username</label>
            <input id="username" type="text" value={form.username} onChange={handleChange} />
          </div>
          <div className="input-group">
            <label htmlFor="twitter">Twitter Handle</label>
            <input id="twitter" type="text" value={form.twitter} onChange={handleChange} />
          </div>
          <div className="input-group">
            <label htmlFor="linkedin">LinkedIn Profile</label>
            <input id="linkedin" type="text" value={form.linkedin} onChange={handleChange} />
          </div>
          <div className="input-group">
            <label htmlFor="instagram">Instagram Handle</label>
            <input id="instagram" type="text" value={form.instagram} onChange={handleChange} placeholder="@username" />
          </div>

          <button type="submit" className="btn-submit" disabled={isUploading}>
            {isUploading ? `Uploading... ${uploadProgress.toFixed(0)}%` : 'Save Profile'}
          </button>
        </form>
        <div className="profile-nav-wrapper">
          {/* This spacer is intentionally left empty */}
          {/* It will take up the same space as the button wrapper */}
          {dailyGroupId && isProfileComplete && (
            <div className="page-nav-header" style={{ visibility: 'hidden' }}>
              <Link href={`/group/${dailyGroupId}`}>
                &larr;
              </Link>
            </div>
          )}
        </div>
      </div>
      {/* --- End of new wrapper --- */}


      <button onClick={handleSignOut} className="btn-sign-out-profile" disabled={isUploading}>
        Sign Out
      </button>
    </main>
  );
}