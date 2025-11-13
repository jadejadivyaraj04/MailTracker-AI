import { useEffect, useMemo, useState } from 'react';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';

const DEFAULT_API_BASE = 'http://localhost:5000';

const getStoredUserId = () => {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem('mailtracker-userId');
};

const setStoredUserId = value => {
  if (typeof window === 'undefined') return;
  if (value) {
    window.localStorage.setItem('mailtracker-userId', value);
  } else {
    window.localStorage.removeItem('mailtracker-userId');
  }
};

function App() {
  const [userId, setUserId] = useState(getStoredUserId);
  const [apiBase, setApiBase] = useState(DEFAULT_API_BASE);

  useEffect(() => {
    setApiBase(import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE);
  }, []);

  useEffect(() => {
    setStoredUserId(userId);
  }, [userId]);

  const handleLogin = value => {
    setUserId(value);
  };

  const handleLogout = () => {
    setUserId(null);
  };

  const dashboardProps = useMemo(() => ({
    userId,
    apiBase,
    onLogout: handleLogout
  }), [userId, apiBase]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {userId ? (
        <Dashboard {...dashboardProps} />
      ) : (
        <Login onLogin={handleLogin} />
      )}
    </div>
  );
}

export default App;
