import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { UserProfile, UserRole } from '../types';
import { Navigate, useLocation } from 'react-router-dom';

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  isAdmin: boolean;
  isStaff: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  loading: true,
  isAdmin: false,
  isStaff: false,
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
            if (user.email?.toLowerCase() === "antar7theman@gmail.com" && data.name === 'Default Admin') {
              const updatedProfile = { ...data, name: 'antar deffas' };
              await setDoc(doc(db, 'users', user.uid), updatedProfile);
              setProfile(updatedProfile);
            } else {
              setProfile(data);
            }
          } else {
            // Check if there's a pre-provisioned profile by email
            const sanitizedEmail = user.email?.replace(/[^a-zA-Z0-9]/g, '_');
            if (sanitizedEmail) {
              const preDoc = await getDoc(doc(db, 'users', sanitizedEmail));
              if (preDoc.exists()) {
                const data = preDoc.data();
                // Claim the profile: move to UID doc
                const newProfile = {
                  ...data,
                  uid: user.uid,
                  name: user.displayName || data.name || 'User'
                } as UserProfile;
                
                await setDoc(doc(db, 'users', user.uid), newProfile);
                await deleteDoc(doc(db, 'users', sanitizedEmail));
                setProfile(newProfile);
                setLoading(false);
                return;
              }
            }

            // Check if it's the default admin
            if (user.email?.toLowerCase() === "antar7theman@gmail.com") {
              const defaultProfile: UserProfile = {
                uid: user.uid,
                email: user.email,
                role: 'admin',
                name: user.displayName || 'antar deffas',
                active: true,
                notificationPreferences: {
                  expiry: { sms: true, email: true, push: true },
                  lowStock: { sms: true, email: true, push: true },
                  task: { sms: true, email: true, push: true }
                }
              };
              await setDoc(doc(db, 'users', user.uid), defaultProfile);
              setProfile(defaultProfile);
            } else {
              setProfile(null);
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

  return (
    <AuthContext.Provider value={{ user, profile, loading, isAdmin, isStaff }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);

export const AuthGuard: React.FC<{ children: React.ReactNode; requiredRole?: UserRole }> = ({ children, requiredRole }) => {
  const { user, profile, loading, isAdmin } = useAuth();
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

  return <>{children}</>;
};
