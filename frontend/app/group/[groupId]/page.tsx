'use client';

import { useState, useEffect } from 'react';
import Head from 'next/head';
import { db, auth } from '../../../lib/firebase';
import { doc, getDoc, DocumentData } from 'firebase/firestore';
import { onAuthStateChanged, User, signOut } from 'firebase/auth';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';

type UserProfile = {
  id: string;
  name: string;     // Real Name
  username: string; // Handle
  email: string;
  profilePictureUrl?: string;
  socials: {
    twitter?: string;
    linkedin?: string;
    instagram?: string;
  };
};

const DEFAULT_AVATAR_URL = 'https://firebasestorage.googleapis.com/v0/b/brillianse-801f7.firebasestorage.app/o/logos%2FBrillianse%20(5)%20copy.png?alt=media&token=ecffd21e-dff9-4151-b57f-5515be4c87e7';

export default function GroupPage() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [members, setMembers] = useState<UserProfile[]>([]);
  
  const [selectedMember, setSelectedMember] = useState<UserProfile | null>(null);
  
  const [showAnswersModal, setShowAnswersModal] = useState(false);
  const [myAnswers, setMyAnswers] = useState<string[]>([]);
  const [questions, setQuestions] = useState<string[]>([]);
  const [answersLoading, setAnswersLoading] = useState(false);

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

        // 1. Fetch the "Master" Config to get the OFFICIAL date
        const configRef = doc(db, 'config', 'daily');
        const configSnap = await getDoc(configRef);
        
        if (!configSnap.exists()) {
             throw new Error('System configuration missing.');
        }
        
        const todayDate = configSnap.data().date; // This is the Server's Game Date

        // 2. Verify the User is allowed to be here for THIS date
        // If their stored group date doesn't match the Server Game Date, they need to replay.
        const userRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);
        
        if (userSnap.exists()) {
            const userData = userSnap.data();
            if (userData.dailyGroup?.date !== todayDate) {
                // Their group data is stale (from yesterday). Redirect to home to reset.
                router.push('/');
                return;
            }
        }

        // 3. Fetch the group using the SERVER date
        const groupRef = doc(db, `daily_groups/${todayDate}/groups`, groupId);
        const groupSnap = await getDoc(groupRef);
        
        if (!groupSnap.exists()) {
           // Group doesn't exist for today -> Redirect Home
           router.push('/');
           return;
        }

        const memberIds: string[] = groupSnap.data().members || [];
        
        if (!memberIds.includes(user.uid)) {
           router.push('/');
           return;
        }

        // 4. Fetch Profiles
        const profilePromises = memberIds.map(id => 
          getDoc(doc(db, 'users', id))
        );
        const profileDocs = await Promise.all(profilePromises);

        const memberProfiles = profileDocs
          .filter(docSnap => docSnap.exists())
          .map(docSnap => {
            const data = docSnap.data() as DocumentData;
            return {
              id: docSnap.id,
              name: data.name || data.username || 'Anonymous', 
              username: data.username || 'user',
              email: data.email,
              profilePictureUrl: data.profilePictureUrl || null,
              socials: data.socials || {},
            };
          });
          
          const sortedMembers = memberProfiles.sort((a, b) => {
            if (a.id === user.uid) return -1; 
            if (b.id === user.uid) return 1;
            return 0; 
          });
  
          setMembers(sortedMembers);
      } catch (err: any) {
        console.error(err);
        setError(err.message || 'Failed to load group members.');
      } finally {
        setLoading(false);
      }
    };
    fetchGroupData();
  }, [groupId, user, router]);

  const handleViewAnswers = async () => {
    setShowAnswersModal(true);
    if (questions.length > 0 && myAnswers.length > 0) return;
    if (!user) return;
    try {
      setAnswersLoading(true);
      const userRef = doc(db, 'users', user.uid);
      const userSnap = await getDoc(userRef);
      if (userSnap.exists()) {
        const data = userSnap.data();
        setMyAnswers(data.dailyGroup?.answers || []);
      }
      const configRef = doc(db, 'config', 'daily');
      const configSnap = await getDoc(configRef);
      if (configSnap.exists()) {
        setQuestions(configSnap.data().questions || []);
      }
    } catch (err) {
      console.error("Error loading answers:", err);
    } finally {
      setAnswersLoading(false);
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

      <div className="header-actions">
        <Link href="/profile" className="btn-sign-in-header">
          Profile
        </Link>
      </div>

      <div className="group-header">
        <h1>Your Group: <code>{groupId}</code></h1>
        {members.length > 1 && (
          <p>Here are the {members.length} members who answered the same as you today.</p>
        )}
        <div className="header-links">
          <button onClick={handleViewAnswers} className="btn-link-style">
            View My Answers
          </button>
        </div>
      </div>

      {members.length === 1 && (
        <p className="group-empty-message">
          You're the first one here. Others are joining soon, check back later!
        </p>
      )}

      <div className="member-list">
        {members.map(member => (
          <div key={member.id}
          className="member-circle-card"
            onClick={() => setSelectedMember(member)}>
            <div className="member-avatar-wrapper">
              <img 
                src={member.profilePictureUrl || DEFAULT_AVATAR_URL} 
                alt="Profile"
                className="member-avatar"
                onError={(e) => (e.currentTarget.src = DEFAULT_AVATAR_URL)}
              />
              {member.id === user?.uid && (
                <span className="you-tag-circle">You</span>
              )}
            </div>
            
            <div className="member-info">
              {/* --- NAME (White, Bold) --- */}
              <h3>{member.name}</h3>
              
              {/* --- USERNAME (Gray, Small) --- */}
              <p className="member-handle">@{member.username}</p>
              
              <div className="social-links">
                {member.socials.twitter && (
                  <a href={`https://twitter.com/${member.socials.twitter.replace('@', '')}`} target="_blank" rel="noopener noreferrer">Twitter</a>
                )}
                {member.socials.linkedin && (
                  <a href={member.socials.linkedin.startsWith('http') ? member.socials.linkedin : `https://${member.socials.linkedin}`} target="_blank" rel="noopener noreferrer">LinkedIn</a>
                )}
                {member.socials.instagram && (
                  <a href={`https://instagram.com/${member.socials.instagram.replace('@', '')}`} target="_blank" rel="noopener noreferrer">Instagram</a>
                )}
                {member.id !== user?.uid && (
                  <a href={`mailto:${member.email}`}>Email</a>
                )}
              </div>
              
              {!member.socials.twitter && !member.socials.linkedin && !member.socials.instagram && member.id !== user?.uid && (
                <p className="no-socials">This user hasn't added their socials yet.</p>
              )}
            </div>
          </div>
        ))}
      </div>
      
      {selectedMember && (
        <div className="member-modal-overlay" onClick={() => setSelectedMember(null)}>
          <div className="member-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="member-modal-image">
              <img 
                src={selectedMember.profilePictureUrl || DEFAULT_AVATAR_URL}
                alt="Profile"
                onError={(e) => (e.currentTarget.src = DEFAULT_AVATAR_URL)}
              />
            </div>
            <div className="member-modal-info">
              {/* --- NAME (White, Bold) --- */}
              <h2>{selectedMember.name}</h2>
              
              {/* --- USERNAME (Gray, Small) --- */}
              <p className="modal-handle">@{selectedMember.username}</p>

              {selectedMember.id === user?.uid && (
                <span className="you-tag-modal">You</span>
              )}
              
              <div className="social-links-modal">
                {selectedMember.socials.twitter && (
                  <a href={`https://twitter.com/${selectedMember.socials.twitter.replace('@', '')}`} target="_blank" rel="noopener noreferrer">Twitter</a>
                )}
                {selectedMember.socials.linkedin && (
                  <a href={selectedMember.socials.linkedin.startsWith('http') ? selectedMember.socials.linkedin : `https://${selectedMember.socials.linkedin}`} target="_blank" rel="noopener noreferrer">LinkedIn</a>
                )}
                {selectedMember.socials.instagram && (
                 <a href={`https://instagram.com/${selectedMember.socials.instagram.replace('@', '')}`} target="_blank" rel="noopener noreferrer">Instagram</a>
                )}
                {selectedMember.id !== user?.uid && (
                  <a href={`mailto:${selectedMember.email}`}>Email</a>
                )}
              </div>
              
              {!selectedMember.socials.twitter && !selectedMember.socials.linkedin && !selectedMember.socials.instagram && selectedMember.id !== user?.uid && (
                <p className="no-socials">This user hasn't added their socials yet.</p>
              )}
            </div>
          </div>
          <p className="modal-exit-text">Press anywhere to exit enlarged view</p>
        </div>
      )}

      {showAnswersModal && (
        <div className="member-modal-overlay" onClick={() => setShowAnswersModal(false)}>
          <div className="answers-modal-content" onClick={(e) => e.stopPropagation()}>
            <h1>Your Answers</h1>
            <p>These are the answers you submitted today.</p>

            {answersLoading ? (
              <p>Loading...</p>
            ) : (
              <div className="answers-list">
                {questions.map((question, index) => (
                  <div 
                    key={index} 
                    className={`answer-item ${myAnswers[index] === 'yes' ? 'answered-yes' : 'answered-no'}`}
                  >
                    <p className="question-text">{index + 1}. {question}</p>
                    <span className={`answer-tag ${myAnswers[index] === 'yes' ? 'yes' : 'no'}`}>
                      {myAnswers[index] || 'No Answer'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <p className="modal-exit-text">Press anywhere to close</p>
        </div>
      )}

    </main>
  );
}