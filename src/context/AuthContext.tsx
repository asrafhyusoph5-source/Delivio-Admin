import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  auth,
  db,
  doc,
  getDoc,
  updateDoc,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
  onAuthStateChanged,
  type FirebaseUser
} from '../firebase';
import type { UserProfile } from '../types';
import { useToast } from './ToastContext';

interface AuthContextType {
  currentUser: FirebaseUser | null;
  adminProfile: UserProfile | null;
  loading: boolean;
  login: (email: string, pass: string) => Promise<void>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updateProfileDetails: (data: { name: string; phone?: string; photoUrl?: string }) => Promise<void>;
  changeAdminPassword: (currentPass: string, newPass: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [adminProfile, setAdminProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const { showSuccess, showError } = useToast();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        try {
          const userDocRef = doc(db, 'users', user.uid);
          const snap = await getDoc(userDocRef);
          
          if (!snap.exists()) {
            await signOut(auth);
            setCurrentUser(null);
            setAdminProfile(null);
            showError('This account is not an admin.');
            setLoading(false);
            return;
          }

          const userData = snap.data();
          const role = String(userData.role || '').toLowerCase();
          
          if (role !== 'admin') {
            await signOut(auth);
            setCurrentUser(null);
            setAdminProfile(null);
            showError('This account is not an admin.');
            setLoading(false);
            return;
          }

          setCurrentUser(user);
          setAdminProfile({
            uid: user.uid,
            role: 'admin',
            email: user.email || userData.email || '',
            name: userData.name || user.displayName || 'Administrator',
            phone: userData.phone || '',
            photoUrl: userData.photoUrl || user.photoURL || '',
            status: userData.status || 'active',
            adminNote: userData.adminNote || '',
            createdAt: userData.createdAt || null
          });
        } catch (err: any) {
          console.error('Error fetching admin user doc:', err);
          await signOut(auth);
          setCurrentUser(null);
          setAdminProfile(null);
          showError(err);
        }
      } else {
        setCurrentUser(null);
        setAdminProfile(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [showError]);

  const login = async (email: string, pass: string) => {
    try {
      const cred = await signInWithEmailAndPassword(auth, email.trim(), pass);
      const userDocRef = doc(db, 'users', cred.user.uid);
      const snap = await getDoc(userDocRef);

      if (!snap.exists()) {
        await signOut(auth);
        throw new Error('This account is not an admin.');
      }

      const userData = snap.data();
      const role = String(userData.role || '').toLowerCase();
      if (role !== 'admin') {
        await signOut(auth);
        throw new Error('This account is not an admin.');
      }

      setCurrentUser(cred.user);
      setAdminProfile({
        uid: cred.user.uid,
        role: 'admin',
        email: cred.user.email || userData.email || '',
        name: userData.name || cred.user.displayName || 'Administrator',
        phone: userData.phone || '',
        photoUrl: userData.photoUrl || cred.user.photoURL || '',
        status: userData.status || 'active',
        createdAt: userData.createdAt || null
      });
      showSuccess(`Welcome back, ${userData.name || 'Admin'}!`);
    } catch (err: any) {
      showError(err);
      throw err;
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
      setCurrentUser(null);
      setAdminProfile(null);
      showSuccess('Logged out successfully');
    } catch (err: any) {
      showError(err);
    }
  };

  const resetPassword = async (email: string) => {
    try {
      await sendPasswordResetEmail(auth, email.trim());
      showSuccess('Password reset link sent to your email.');
    } catch (err: any) {
      showError(err);
      throw err;
    }
  };

  const updateProfileDetails = async (data: { name: string; phone?: string; photoUrl?: string }) => {
    if (!currentUser) return;
    try {
      const userRef = doc(db, 'users', currentUser.uid);
      await updateDoc(userRef, {
        name: data.name,
        phone: data.phone || '',
        photoUrl: data.photoUrl || '',
        updatedAt: new Date()
      });

      setAdminProfile((prev) => (prev ? { ...prev, ...data } : null));
      showSuccess('Profile updated successfully');
    } catch (err: any) {
      showError(err);
      throw err;
    }
  };

  const changeAdminPassword = async (currentPass: string, newPass: string) => {
    if (!currentUser || !currentUser.email) return;
    try {
      const credential = EmailAuthProvider.credential(currentUser.email, currentPass);
      await reauthenticateWithCredential(currentUser, credential);
      await updatePassword(currentUser, newPass);
      showSuccess('Password changed successfully');
    } catch (err: any) {
      showError(err);
      throw err;
    }
  };

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        adminProfile,
        loading,
        login,
        logout,
        resetPassword,
        updateProfileDetails,
        changeAdminPassword
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
