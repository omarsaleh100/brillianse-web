'use client';

import { useState, useEffect } from 'react';
import Head from 'next/head';
import { db, auth, storage } from '../../lib/firebase'; // <-- Import storage
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { onAuthStateChanged, User, signOut } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { 
  ref, 
  uploadBytesResumable, 
  getDownloadURL 
} from 'firebase/storage';

export default function Profile() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [form, setForm] = useState({
    username: '',
    twitter: '',
    linkedin: '',
    website: '',
  });
  
  const [dailyGroupId, setDailyGroupId] = useState<string | null>(null);
  
  const [profilePicUrl, setProfilePicUrl] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  
  const router = useRouter();

  // --- 1. Listen for user and load profile ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        const userRef = doc(db, 'users', currentUser.uid);
        const docSnap = await getDoc(userRef);
        
        if (docSnap.exists()) {
          const data = docSnap.data();
          let suggestedUsername = data.username || '';
          if (!data.isProfileComplete) {
            const name = currentUser.email?.split('@')[0].replace(/[^a-zA-Z0-9]/g, '') || 'user';
            suggestedUsername = `${name}${Math.floor(100 + Math.random() * 900)}`;
          }
          setForm({
            username: data.username || suggestedUsername,
            twitter: data.socials?.twitter || '',
            linkedin: data.socials?.linkedin || '',
            website: data.socials?.website || '',
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

    const { username, twitter, linkedin, website } = form;
    if (!username) {
      setValidationError('Username is required.');
      return;
    }
    if (!twitter && !linkedin && !website) {
      setValidationError('Please add at least one social media handle.');
      return;
    }

    try {
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

      const userRef = doc(db, 'users', user.uid);
      
      await setDoc(userRef, {
        username: username,
        email: user.email,
        socials: {
          twitter: twitter,
          linkedin: linkedin,
          website: website,
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
          {dailyGroupId && (
            <div className="page-nav-header">
              <Link href={`/group/${dailyGroupId}`}>
                &larr; Back to Group
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

          <div className="pfp-uploader">
            <label htmlFor="file-input">
              <img 
                src={profilePicUrl || '/default-avatar.png'} 
                alt="Profile" 
                className="pfp-preview"
                onError={(e) => (e.currentTarget.src = 'https://placehold.co/150x150/f0f0f0/333?text=?')}
              />
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
            <label htmlFor="website">Personal Website</label>
            <input id="website" type="text" value={form.website} onChange={handleChange} />
          </div>

          <button type="submit" className="btn-submit" disabled={isUploading}>
            {isUploading ? `Uploading... ${uploadProgress.toFixed(0)}%` : 'Save Profile'}
          </button>
        </form>
        <div className="profile-nav-wrapper">
          {/* This spacer is intentionally left empty */}
          {/* It will take up the same space as the button wrapper */}
          {dailyGroupId && (
            <div className="page-nav-header" style={{ visibility: 'hidden' }}>
              <Link href={`/group/${dailyGroupId}`}>
                &larr; Back to Group
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