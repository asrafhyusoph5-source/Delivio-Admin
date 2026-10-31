import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
  onAuthStateChanged,
  type User as FirebaseUser
} from 'firebase/auth';
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  query,
  where,
  limit,
  startAfter,
  onSnapshot,
  writeBatch,
  runTransaction,
  arrayUnion,
  increment,
  deleteField,
  Timestamp,
  serverTimestamp,
  type QuerySnapshot,
  type DocumentData,
  type DocumentSnapshot,
  type Unsubscribe
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyCHg2ETuTfSzlZZKvw3cW_8SzkF1S7NRFo",
  authDomain: "delivio-371d3.firebaseapp.com",
  projectId: "delivio-371d3",
  storageBucket: "delivio-371d3.firebasestorage.app",
  messagingSenderId: "490983557590",
  appId: "1:490983557590:web:bda8ce4fdad8b7f9467c77"
};

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);
export const db = getFirestore(app);

export {
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
  onAuthStateChanged,
  type FirebaseUser,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  query,
  where,
  limit,
  startAfter,
  onSnapshot,
  writeBatch,
  runTransaction,
  arrayUnion,
  increment,
  deleteField,
  Timestamp,
  serverTimestamp,
  type QuerySnapshot,
  type DocumentData,
  type DocumentSnapshot,
  type Unsubscribe
};
