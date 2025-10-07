import { auth } from "@cafeore/common";
import { type User, onAuthStateChanged } from "firebase/auth";
import { useEffect, useState } from "react";

export const useAuth = () => {
  const [user, setUser] = useState<User | null>(null);

  useEffect(
    () =>
      onAuthStateChanged(auth, (user) => {
        if (user?.emailVerified) {
          setUser(user);
        } else {
          setUser(null);
        }
      }),
    [],
  );

  return user;
};
