import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AppProvider } from "./context/AppContext.jsx";
import AppLayout from "./layouts/AppLayout";
import Dashboard from "./pages/Dashboard";
import Employees from "./pages/Employees";
import Workspaces from "./pages/Workspaces";
import ShiftManagement from "./pages/ShiftManagement";
import Settings from "./pages/Settings";

const CloudSavings = lazy(() => import("./pages/CloudSavings"));
const AnalyticsPage = lazy(() => import("./pages/AnalyticsPage"));

function PageFallback() {
  return (
    <div className="space-y-4">
      <div className="h-8 w-56 animate-pulse rounded bg-slate-800"></div>
      <div className="h-72 animate-pulse rounded-2xl bg-slate-900"></div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppProvider>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/employees" element={<Employees />} />
            <Route path="/workspaces" element={<Workspaces />} />
            <Route path="/shift-management" element={<ShiftManagement />} />
            <Route
              path="/cloud-savings"
              element={
                <Suspense fallback={<PageFallback />}>
                  <CloudSavings />
                </Suspense>
              }
            />
            <Route
              path="/analytics"
              element={
                <Suspense fallback={<PageFallback />}>
                  <AnalyticsPage />
                </Suspense>
              }
            />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Dashboard />} />
          </Route>
        </Routes>
      </AppProvider>
    </BrowserRouter>
  );
}
