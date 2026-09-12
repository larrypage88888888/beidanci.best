import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuthStore } from './stores/auth';
import Layout from './components/Layout';
import AuthPage from './pages/AuthPage';
import PlacementPage from './pages/PlacementPage';
import TodayPage from './pages/TodayPage';
import WordsPage from './pages/WordsPage';
import StatsPage from './pages/StatsPage';
import SettingsPage from './pages/SettingsPage';

/** 登录守卫 + 摸底引导：未登录去登录页；没做过摸底先去做题 */
function RequireAuth({ children }: { children: ReactNode }) {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const location = useLocation();

  if (!token) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (user && !user.placementDone && location.pathname !== '/placement') {
    return <Navigate to="/placement" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  // 任意请求收到 401（token 过期/失效）→ 统一登出，守卫自动跳登录页
  const logout = useAuthStore((s) => s.logout);
  useEffect(() => {
    const onUnauthorized = () => logout();
    window.addEventListener('wordflow:unauthorized', onUnauthorized);
    return () => window.removeEventListener('wordflow:unauthorized', onUnauthorized);
  }, [logout]);

  return (
    <Routes>
      <Route path="/login" element={<AuthPage />} />
      <Route
        path="/placement"
        element={
          <RequireAuth>
            <Layout>
              <PlacementPage />
            </Layout>
          </RequireAuth>
        }
      />
      <Route
        path="/today"
        element={
          <RequireAuth>
            <Layout>
              <TodayPage />
            </Layout>
          </RequireAuth>
        }
      />
      <Route
        path="/words"
        element={
          <RequireAuth>
            <Layout>
              <WordsPage />
            </Layout>
          </RequireAuth>
        }
      />
      <Route
        path="/stats"
        element={
          <RequireAuth>
            <Layout>
              <StatsPage />
            </Layout>
          </RequireAuth>
        }
      />
      <Route
        path="/settings"
        element={
          <RequireAuth>
            <Layout>
              <SettingsPage />
            </Layout>
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/today" replace />} />
    </Routes>
  );
}
