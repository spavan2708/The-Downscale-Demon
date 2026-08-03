const API_BASE_URL = 'http://localhost:5000/api';

// 1. Fetch all employees with shift validation
export const fetchEmployees = async () => {
  try {
    const response = await fetch(`${API_BASE_URL}/employees`);
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('Error fetching employees:', error);
    return [];
  }
};

// 2. Fetch all developer workspaces
export const fetchWorkspaces = async () => {
  try {
    const response = await fetch(`${API_BASE_URL}/workspaces`);
    const data = await response.json();
    return data.data || [];
  } catch (error) {
    console.error('Error fetching workspaces:', error);
    return [];
  }
};

// 3. Wake workspace on demand
export const wakeWorkspace = async (id) => {
  try {
    const response = await fetch(`${API_BASE_URL}/workspaces/${id}/wake`, { 
      method: 'POST' 
    });
    return await response.json();
  } catch (error) {
    console.error('Error waking workspace:', error);
    return { success: false, message: 'Server unreachable' };
  }
};

// 4. Downscale workspace to zero
export const scaleToZero = async (id) => {
  try {
    const response = await fetch(`${API_BASE_URL}/workspaces/${id}/scale-to-zero`, { 
      method: 'POST' 
    });
    return await response.json();
  } catch (error) {
    console.error('Error scaling workspace to zero:', error);
    return { success: false, message: 'Server unreachable' };
  }
};

// 5. Login user and receive JWT
export const loginUser = async (username, password, role) => {
  try {
    const response = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, role })
    });
    return await response.json();
  } catch (error) {
    console.error('Error logging in:', error);
    return { success: false, message: 'Authentication failed' };
  }
};