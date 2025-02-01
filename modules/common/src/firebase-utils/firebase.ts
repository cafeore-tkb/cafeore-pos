import { type FirebaseOptions, initializeApp } from "firebase/app";
import {
  GoogleAuthProvider,
  getAuth,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import { getFirestore, initializeFirestore } from "firebase/firestore";

const firebaseConfig: FirebaseOptions = {
  apiKey: "AIzaSyC3llKAZQOVQEFV0-0xHiseDB55YXJilHM",
  authDomain: "cafeore-2024.firebaseapp.com",
  projectId: "cafeore-2024",
  storageBucket: "cafeore-2024.appspot.com",
  messagingSenderId: "715397785293",
  appId: "1:715397785293:web:b84ff1ca0163a1f8b46b84",
};

const app = initializeApp(firebaseConfig);

initializeFirestore(app, {
  ignoreUndefinedProperties: true,
});

export const prodDB = getFirestore(app);

export const auth = getAuth(app);

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

export const login = () => {
  signInWithPopup(auth, provider)
    .then((result) => {
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (credential == null) {
        console.log("credential is null");
        return;
      }
      const token = credential.accessToken;
      const user = result.user;
      console.log("user", user);
    })
    .catch((err) => {
      const errorCode = err.code;
      const errorMessage = err.message;
      const email = err.customData.email;
      const credential = GoogleAuthProvider.credentialFromError(err);
      console.log("errorCode", errorCode);
      console.log("errorMessage", errorMessage);
      console.log("email", email);
      console.log("credential", credential);
    });
};

export const logout = async () => {
  await signOut(auth);
};
