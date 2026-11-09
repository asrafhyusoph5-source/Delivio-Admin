import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  auth,
  db,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  signInWithEmailAndPassword,
  signOut,
  createUserWithEmailAndPassword,
  updateProfile,
  sendEmailVerification,
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
  isFullAdmin: boolean;
  canAccess: (section: 'support' | 'finance' | 'settings' | 'general' | 'suspend') => boolean;
  login: (email: string, pass: string) => Promise<void>;
  registerStaff: (email: string, pass: string, name?: string) => Promise<{ needVerification: boolean }>;
  resendVerification: (userObj?: FirebaseUser) => Promise<void>;
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

  const isFullAdmin = Boolean(
    adminProfile &&
    (adminProfile.role === 'admin' || !adminProfile.adminRole || adminProfile.adminRole === 'admin')
  );

  const canAccess = (section: 'support' | 'finance' | 'settings' | 'general' | 'suspend'): boolean => {
    if (!adminProfile) return false;
    if (isFullAdmin) return true;
    const role = adminProfile.adminRole;
    if (section === 'settings' || section === 'suspend') {
      return false; // Only full admins can change settings or suspend accounts
    }
    if (role === 'support') {
      return section === 'support' || section === 'general';
    }
    if (role === 'finance') {
      return section === 'finance' || section === 'general';
    }
    return false;
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        try {
          const emailLower = (user.email || '').toLowerCase().trim();
          const userDocRef = doc(db, 'users', user.uid);
          let snap = await getDoc(userDocRef);

          // If user doc doesn't exist yet, check if there's a pending staffInvite
          if (!snap.exists() && emailLower) {
            const inviteRef = doc(db, 'staffInvites', emailLower);
            const inviteSnap = await getDoc(inviteRef);
            if (inviteSnap.exists()) {
              if (!user.emailVerified) {
                await signOut(auth);
                setCurrentUser(null);
                setAdminProfile(null);
                setLoading(false);
                return;
              }

              // Email is verified! Convert invite to user doc
              const inviteData = inviteSnap.data();
              const assignedAdminRole = inviteData.adminRole || 'support';
              const assignedRole = assignedAdminRole === 'admin' ? 'admin' : 'subadmin';
              const newProfile = {
                uid: user.uid,
                role: assignedRole,
                adminRole: assignedAdminRole,
                email: emailLower,
                name: user.displayName || emailLower.split('@')[0],
                status: 'active' as const,
                createdAt: new Date()
              };

              await setDoc(userDocRef, newProfile);
              await deleteDoc(inviteRef);
              snap = await getDoc(userDocRef);
            }
          }

          if (!snap.exists()) {
            await signOut(auth);
            setCurrentUser(null);
            setAdminProfile(null);
            showError('This account is not an administrator or staff member.');
            setLoading(false);
            return;
          }

          const userData = snap.data();
          const role = String(userData.role || '').toLowerCase();

          if (role !== 'admin' && role !== 'subadmin') {
            await signOut(auth);
            setCurrentUser(null);
            setAdminProfile(null);
            showError('This account does not have admin or sub-admin access.');
            setLoading(false);
            return;
          }

          // Check if account is suspended
          if (userData.status === 'suspended') {
            await signOut(auth);
            setCurrentUser(null);
            setAdminProfile(null);
            showError('Your staff account has been suspended. Please contact the administrator.');
            setLoading(false);
            return;
          }

          // If subadmin and not email verified, block login
          if (role === 'subadmin' && !user.emailVerified) {
            await signOut(auth);
            setCurrentUser(null);
            setAdminProfile(null);
            showError('Please verify your email address before logging in.');
            setLoading(false);
            return;
          }

          setCurrentUser(user);
          setAdminProfile({
            uid: user.uid,
            role: role as any,
            adminRole: userData.adminRole || (role === 'admin' ? 'admin' : 'support'),
            email: user.email || userData.email || '',
            name: userData.name || user.displayName || (role === 'admin' ? 'Administrator' : 'Staff Member'),
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
      const emailLower = email.trim().toLowerCase();
      const cred = await signInWithEmailAndPassword(auth, emailLower, pass);
      const user = cred.user;
      const userDocRef = doc(db, 'users', user.uid);
      let snap = await getDoc(userDocRef);

      // Check if this is an invited staff member signing in for the first time
      if (!snap.exists()) {
        const inviteRef = doc(db, 'staffInvites', emailLower);
        const inviteSnap = await getDoc(inviteRef);
        if (inviteSnap.exists()) {
          if (!user.emailVerified) {
            await signOut(auth);
            throw new Error('Please verify your email address before logging in. Check your inbox for the verification link.');
          }

          const inviteData = inviteSnap.data();
          const assignedAdminRole = inviteData.adminRole || 'support';
          const assignedRole = assignedAdminRole === 'admin' ? 'admin' : 'subadmin';
          const newProfile = {
            uid: user.uid,
            role: assignedRole,
            adminRole: assignedAdminRole,
            email: emailLower,
            name: user.displayName || emailLower.split('@')[0],
            status: 'active' as const,
            createdAt: new Date()
          };

          await setDoc(userDocRef, newProfile);
          await deleteDoc(inviteRef);
          snap = await getDoc(userDocRef);
        } else {
          await signOut(auth);
          throw new Error('This account is not authorized as an admin or staff member.');
        }
      }

      const userData = (snap.data() || {}) as Record<string, any>;
      const role = String(userData.role || '').toLowerCase();
      if (role !== 'admin' && role !== 'subadmin') {
        await signOut(auth);
        throw new Error('This account does not have admin or sub-admin privileges.');
      }

      if (userData.status === 'suspended') {
        await signOut(auth);
        throw new Error('Your staff account has been suspended. Please contact the administrator.');
      }

      if (role === 'subadmin' && !user.emailVerified) {
        await signOut(auth);
        throw new Error('Please verify your email address before logging in. A verification email was sent to your inbox.');
      }

      setCurrentUser(user);
      setAdminProfile({
        uid: user.uid,
        role: role as any,
        adminRole: userData.adminRole || (role === 'admin' ? 'admin' : 'support'),
        email: user.email || userData.email || '',
        name: userData.name || user.displayName || (role === 'admin' ? 'Administrator' : 'Staff Member'),
        phone: userData.phone || '',
        photoUrl: userData.photoUrl || user.photoURL || '',
        status: userData.status || 'active',
        createdAt: userData.createdAt || null
      });
      showSuccess(`Welcome back, ${userData.name || 'Admin'}!`);
    } catch (err: any) {
      showError(err);
      throw err;
    }
  };

  const registerStaff = async (email: string, pass: string, name?: string) => {
    try {
      const emailLower = email.trim().toLowerCase();
      // First verify staff invite exists
      const inviteRef = doc(db, 'staffInvites', emailLower);
      const inviteSnap = await getDoc(inviteRef);
      if (!inviteSnap.exists()) {
        throw new Error(`No staff invitation found for ${emailLower}. Please request an invite from the administrator.`);
      }

      const cred = await createUserWithEmailAndPassword(auth, emailLower, pass);
      if (name && cred.user) {
        await updateProfile(cred.user, { displayName: name.trim() });
      }

      // Send Firebase verification email
      await sendEmailVerification(cred.user);
      await signOut(auth); // block login until verified

      showSuccess(`Invitation accepted! A verification email has been sent to ${emailLower}. Please verify your email before logging in.`);
      return { needVerification: true };
    } catch (err: any) {
      showError(err);
      throw err;
    }
  };

  const resendVerification = async (userObj?: FirebaseUser) => {
    try {
      const targetUser = userObj || currentUser || auth.currentUser;
      if (!targetUser) {
        throw new Error('No user to send verification email to.');
      }
      await sendEmailVerification(targetUser);
      showSuccess('Verification email resent. Please check your inbox and spam folder.');
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
        isFullAdmin,
        canAccess,
        login,
        registerStaff,
        resendVerification,
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
