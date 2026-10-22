import React, {createContext, useContext, useState} from 'react';

const AuthContext = createContext();
const API_BASE_URL = 'http://3.27.211.126:8000';

export function AuthProvider({children}) {
  const [session, setSession] = useState(null);

  const api = async (path, options = {}) => {
    // Prepend http://3.27.211.126:8000 to relative API routes
    const url = path.startsWith('http') ? path : `${API_BASE_URL}${path}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(session ? {Authorization: `Bearer ${session.access_token}`} : {}),
        ...options.headers,
      },
    });

    const text = await response.text();
    let body = {};
    if (text) {
      try {
        body = JSON.parse(text);
      } catch (err) {
        body = { detail: text };
      }
    }

    if (!response.ok) {
      if (response.status === 401) setSession(null);
      const errorMessage = typeof body.detail === 'string' 
        ? body.detail 
        : Array.isArray(body.detail)
          ? body.detail.map(e => e.msg || JSON.stringify(e)).join(', ')
          : JSON.stringify(body.detail || 'Server returned an error');
      throw new Error(errorMessage);
    }

    return body;
  };

  return (
    <AuthContext.Provider
      value={{
        currentUser: session?.user,
        token: session?.access_token,
        setSession,
        api,
        hasAccess: role =>
          ({employee: 1, manager: 2, team_lead: 2, admin: 3, chief_architect: 3}[session?.user?.role || ''] >=
          {employee: 1, manager: 2, team_lead: 2, admin: 3, chief_architect: 3}[role]),
      }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);