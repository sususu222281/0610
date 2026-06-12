/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { initializeApp } from "firebase/app";
import { 
  getAuth, 
  GoogleAuthProvider, 
  EmailAuthProvider,
  sendEmailVerification,
  sendPasswordResetEmail
} from "firebase/auth";

// Your web app's Firebase configuration from the user's snippet
const firebaseConfig = {
  apiKey: "AIzaSyDMCuQQ3M7sWMaGW0YWDvE697RmrAMz17Q",
  authDomain: "project-20260610.firebaseapp.com",
  projectId: "project-20260610",
  storageBucket: "project-20260610.firebasestorage.app",
  messagingSenderId: "320247434278",
  appId: "1:320247434278:web:538c5b11ff466eef8d6ae7",
  measurementId: "G-FEC7K6HZWT"
};

import { getFirestore } from "firebase/firestore";

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase Firestore
export const db = getFirestore(app);

// Initialize Firebase Authentication
export const auth = getAuth(app);

// Configure Google Provider
export const googleProvider = new GoogleAuthProvider();
// Request email permission explicitly to ensure it is returned
googleProvider.addScope("email");
googleProvider.addScope("profile");

// Optional custom parameters to prompt user for account selection
googleProvider.setCustomParameters({
  prompt: "select_account"
});

export default app;
