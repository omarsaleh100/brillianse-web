'use client';

import { useState, useEffect } from 'react';
import Head from 'next/head';
import { db, auth } from '../../../lib/firebase';
import { doc, getDoc, DocumentData } from 'firebase/firestore';
import { onAuthStateChanged, User, signOut } from 'firebase/auth';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';

function getTodayDate() {
  return new Date().toISOString().split('T')[0];
}

// --- MODIFIED: Add profilePictureUrl ---
type UserProfile = {
  id: string;
  username: string;
  email: string;
  profilePictureUrl?: string; // <-- NEW
  socials: {
    twitter?: string;
    linkedin?: string;
    website?: string;
  };
};

export default function GroupPage() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [members, setMembers] = useState<UserProfile[]>([]);
  
  const router = useRouter();
  const params = useParams();
  const groupId = params.groupId as string;

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (!currentUser) {
        router.push('/');
      }
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, [router]);

  useEffect(() => {
    if (!groupId || !user) return;
    const fetchGroupData = async () => {
      try {
        setLoading(true);
        setError(null);
        const today = getTodayDate();
        
        const groupRef = doc(db, `daily_groups/${today}/groups`, groupId);
        const groupSnap = await getDoc(groupRef);
        if (!groupSnap.exists()) {
          throw new Error('This group does not exist or has not been formed yet.');
        }

        const memberIds: string[] = groupSnap.data().members || [];
        const profilePromises = memberIds.map(id => 
          getDoc(doc(db, 'users', id))
        );
        const profileDocs = await Promise.all(profilePromises);

        // --- MODIFIED: Get the profilePictureUrl ---
        const memberProfiles = profileDocs
          .filter(docSnap => docSnap.exists())
          .map(docSnap => {
            const data = docSnap.data() as DocumentData;
            return {
              id: docSnap.id,
              username: data.username || 'Anonymous User',
              email: data.email,
              profilePictureUrl: data.profilePictureUrl || null, // <-- NEW
              socials: data.socials || {},
            };
          });
        setMembers(memberProfiles);
      } catch (err: any) {
        console.error(err);
        setError(err.message || 'Failed to load group members.');
      } finally {
        setLoading(false);
      }
    };
    fetchGroupData();
  }, [groupId, user]);

  const handleSignOut = async () => {
    try {
      await signOut(auth);
    } catch (err) {
      console.error('Failed to sign out:', err);
    }
  };

  if (loading) {
    return <main className="loading-container">Loading your group...</main>;
  }
  if (error) {
    return <main className="error-container">{error}</main>;
  }

  return (
    <main>
      <Head>
        <title>Your Daily Group</title>
      </Head>

      <div className="group-header">
        <h1>Your Group: <code>{groupId}</code></h1>
        <p>Here are the {members.length} members who answered the same as you today.</p>
        <div className="header-links">
          <Link href="/profile">Edit Your Profile</Link>
          <Link href="/answers">View My Answers</Link>
          <button onClick={handleSignOut} className="btn-sign-out">
            Sign Out
          </button>
        </div>
      </div>

      <div className="member-list">
        {members.map(member => (
          <div key={member.id} className="member-card">
            {/* --- NEW: Profile Picture --- */}
            <img 
              src={member.profilePictureUrl || 'https://placehold.co/100x100/f0f0f0/333?text=?'} 
              alt="Profile"
              className="member-avatar"
              onError={(e) => (e.currentTarget.src = 'https://placehold.co/100x100/f0f0f0/333?text=?')}
            />
            {/* ---------------------------- */}
            
            <div className="member-info">
              <h3>
                {member.username}
                {member.id === user?.uid && (
                  <span className="you-tag">(This is you)</span>
                )}
              </h3>
              
              <div className="social-links">
                {/* ... (social links unchanged) ... */}
                {member.socials.twitter && (
                  <a href={`https://twitter.com/${member.socials.twitter.replace('@', '')}`} target="_blank" rel="noopener noreferrer">Twitter</a>
                )}
                {member.socials.linkedin && (
                  <a href={member.socials.linkedin.startsWith('http') ? member.socials.linkedin : `https://${member.socials.linkedin}`} target="_blank" rel="noopener noreferrer">LinkedIn</a>
                )}
                {member.socials.website && (
                  <a href={member.socials.website.startsWith('http') ? member.socials.website : `https://${member.socials.website}`} target="_blank" rel="noopener noreferrer">Website</a>
                )}
                {member.id !== user?.uid && (
                  <a href={`mailto:${member.email}`}>Email</a>
                )}
              </div>
              
              {!member.socials.twitter && !member.socials.linkedin && !member.socials.website && member.id !== user?.uid && (
                <p className="no-socials">This user hasn't added their socials yet.</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}