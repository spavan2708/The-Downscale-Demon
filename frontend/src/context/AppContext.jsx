import React, { createContext, useContext, useState } from 'react';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  // Roles: 'employee', 'manager', 'admin'
  const [currentUser, setCurrentUser] = useState({ id: 'EMP-902', name: 'DEV_OPERATOR', role: 'admin' });

  const hasAccess = (requiredRole) => {
    const roles = { employee: 1, manager: 2, admin: 3 };
    return roles[currentUser.role] >= roles[requiredRole];
  };

  return (
    <AuthContext.Provider value={{ currentUser, setCurrentUser, hasAccess }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);