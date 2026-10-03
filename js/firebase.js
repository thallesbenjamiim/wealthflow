// WealthFlow — conexão com o Firebase (Firestore + Auth). Módulo ES: expõe tudo em window._db/_auth/_dbFns/_authFns.

  import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
  import { getFirestore, doc, setDoc, getDoc, collection, getDocs, addDoc, orderBy, query, runTransaction } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
  import { getAuth, signInAnonymously, signInWithCustomToken, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";

  const firebaseConfig = {
    apiKey: "AIzaSyCejJT1foVuX1bCiqK0PMiLLrK5pg6hwKA",
    authDomain: "wealthflow-bbd0d.firebaseapp.com",
    projectId: "wealthflow-bbd0d",
    storageBucket: "wealthflow-bbd0d.firebasestorage.app",
    messagingSenderId: "970496094117",
    appId: "1:970496094117:web:4c8a5f9083d253180a024c",
    measurementId: "G-FLG0G3CMCN"
  };

  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);
  const auth = getAuth(app);
  window._db = db;
  window._auth = auth;
  window._dbFns = { doc, setDoc, getDoc, collection, getDocs, addDoc, orderBy, query, runTransaction };
  window._authFns = { signInAnonymously, signInWithCustomToken, signOut, onAuthStateChanged };
  window._dbReady = true;
  window.dispatchEvent(new Event('dbready'));
