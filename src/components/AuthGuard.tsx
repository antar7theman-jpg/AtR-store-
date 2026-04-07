import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc, setDoc, deleteDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { UserProfile, UserRole } from '../types';
import { Navigate, useLocation } from 'react-router-dom';

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  isAdmin: boolean;
  isStaff: boolean;
  isUser: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  loading: true,
  isAdmin: false,
  isStaff: false,
  isUser: false,
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setUser(user);
      if (user) {
        try {
          const userDoc = await getDoc(doc(db, 'users', user.uid));
          if (userDoc.exists()) {
            const data = userDoc.data() as UserProfile;
            // Ensure UID is correct in the document
            if (data.uid !== user.uid) {
              const updatedProfile = { ...data, uid: user.uid };
              await updateDoc(doc(db, 'users', user.uid), { uid: user.uid });
              setProfile(updatedProfile);
            } else if (user.email?.toLowerCase() === "antar7theman@gmail.com" && data.name === 'Default Admin') {
              const updatedProfile = { ...data, name: 'antar deffas' };
              await updateDoc(doc(db, 'users', user.uid), { name: 'antar deffas' });
              setProfile(updatedProfile);
            } else {
              setProfile(data);
            }
          } else {
            // Check if there's a pre-provisioned profile by email (both sanitized and unsanitized)
            const email = user.email?.toLowerCase();
            if (email) {
              const sanitizedEmail = email.replace(/[^a-zA-Z0-9]/g, '_');
              
              // Try sanitized first
              let preDoc = await getDoc(doc(db, 'users', sanitizedEmail));
              let preDocId = sanitizedEmail;
              
              // If not found, try unsanitized (legacy)
              if (!preDoc.exists()) {
                preDoc = await getDoc(doc(db, 'users', email));
                preDocId = email;
              }

              if (preDoc.exists()) {
                const data = preDoc.data();
                // Claim the profile: move to UID doc
                const newProfile = {
                  ...data,
                  uid: user.uid,
                  email: user.email,
                  name: user.displayName || data.name || 'User',
                  active: true // Ensure active on claim
                } as UserProfile;
                
                await setDoc(doc(db, 'users', user.uid), newProfile);
                if (preDocId !== user.uid) {
                  await deleteDoc(doc(db, 'users', preDocId));
                }
                setProfile(newProfile);
                setLoading(false);
                return;
              }
            }

            // Check if it's the default admin
            if (user.email?.toLowerCase() === "antar7theman@gmail.com") {
              const defaultProfile: UserProfile = {
                uid: user.uid,
                email: user.email || '',
                role: 'admin',
                name: user.displayName || 'antar deffas',
                photoUrl: user.photoURL || undefined,
                active: true,
                notificationPreferences: {
                  expiry: { push: true, email: true, sms: true },
                  lowStock: { push: true, email: true, sms: true },
                  task: { push: true, email: true, sms: true }
                }
              };
              await setDoc(doc(db, 'users', user.uid), defaultProfile);
              setProfile(defaultProfile);
            } else {
              // Create a default user profile for any other authenticated user
              const defaultUserProfile: UserProfile = {
                uid: user.uid,
                email: user.email || '',
                role: 'user',
                name: user.displayName || 'User',
                photoUrl: user.photoURL || undefined,
                active: true,
                notificationPreferences: {
                  expiry: { push: true, email: true, sms: true },
                  lowStock: { push: true, email: true, sms: true },
                  task: { push: true, email: true, sms: true }
                }
              };
              await setDoc(doc(db, 'users', user.uid), defaultUserProfile);
              setProfile(defaultUserProfile);
            }
          }
        } catch (error) {
          console.error("Error fetching user profile:", error);
          setProfile(null);
        }
      } else {
        setProfile(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const isAdmin = profile?.role === 'admin';
  const isStaff = profile?.role === 'staff';
  const isUser = profile?.role === 'user';

  return (
    <AuthContext.Provider value={{ user, profile, loading, isAdmin, isStaff, isUser }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);

export const AuthGuard: React.FC<{ children: React.ReactNode; requiredRole?: UserRole }> = ({ children, requiredRole }) => {
  const { user, profile, loading, isAdmin, isStaff } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (requiredRole === 'admin' && !isAdmin) {
    return <Navigate to="/" replace />;
  }

  if (requiredRole === 'staff' && !isAdmin && !isStaff) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};
