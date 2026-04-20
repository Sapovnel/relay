import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import type { ReactElement } from 'react';
import Home from './pages/Home';
import Room from './pages/Room';
import Join from './pages/Join';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import './index.css';

function Protected({ children }: { children: ReactElement }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/" replace />;
  return children;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <AuthProvider>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route
          path="/room/:id"
          element={
            <Protected>
              <Room />
            </Protected>
          }
        />
        <Route
          path="/join/:id"
          element={
            <Protected>
              <Join />
            </Protected>
          }
        />
      </Routes>
    </BrowserRouter>
  </AuthProvider>,
);
