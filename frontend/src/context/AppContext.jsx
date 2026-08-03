import React, { createContext, useState, useEffect, useContext } from 'react';
import { fetchEmployees, fetchWorkspaces, wakeWorkspace, scaleToZero } from '../services/employeeService';

export const AppContext = createContext();

export const AppProvider = ({ children }) => {
  const [employees, setEmployees] = useState([]);
  const [workspaces, setWorkspaces] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    setLoading(true);
    const empData = await fetchEmployees();
    const wsData = await fetchWorkspaces();

    setEmployees(Array.isArray(empData) ? empData : []);
    setWorkspaces(Array.isArray(wsData) ? wsData : []);
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleWake = async (id) => {
    const res = await wakeWorkspace(id);
    if (res.success) {
      await loadData();
    } else {
      alert(res.message || 'Action failed');
    }
  };

  const handleScaleDown = async (id) => {
    const res = await scaleToZero(id);
    if (res.success) {
      await loadData();
    } else {
      alert(res.message || 'Action failed');
    }
  };

  return (
    <AppContext.Provider value={{
      employees,
      workspaces,
      loading,
      refreshData: loadData,
      handleWake,
      handleScaleDown
    }}>
      {children}
    </AppContext.Provider>
  );
};

// Export useApp hook in case components import it directly from context
export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};