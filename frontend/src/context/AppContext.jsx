import React, {createContext, useContext, useState} from 'react';
const AuthContext = createContext();
export function AuthProvider({children}) {
  const [session, setSession] = useState(null);
  const api = async (path, options = {}) => {
    const response = await fetch(path, {...options, headers: {'Content-Type': 'application/json', ...(session ? {Authorization: `Bearer ${session.access_token}`} : {}), ...options.headers}});
    const body = await response.json();
    if (!response.ok) {
      if (response.status === 401) setSession(null);
      throw new Error(typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail));
    }
    return body;
  };
  return <AuthContext.Provider value={{currentUser: session?.user, token: session?.access_token, setSession, api, hasAccess: role => ({employee: 1, manager: 2, admin: 3}[session?.user.role] >= {employee: 1, manager: 2, admin: 3}[role])}}>{children}</AuthContext.Provider>;
}
export const useAuth = () => useContext(AuthContext);
