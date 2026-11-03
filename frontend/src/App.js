import "@/App.css";
import { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { SettingsProvider } from "@/context/SettingsContext";
import { AppShell } from "@/components/AppShell";
import Login from "@/pages/Login";
import Signup from "@/pages/Signup";
import ForgotPassword from "@/pages/ForgotPassword";
import ResetPassword from "@/pages/ResetPassword";

import { BootSkeleton, RouteSkeleton, hasSessionHint } from "@/components/RouteSkeleton";
import { pageLoaders } from "@/lib/routes";

// Each page is its own chunk, so the first paint downloads far less. Chunks are also preloaded on hover/idle.
const Home = lazy(pageLoaders["/"]);
const Money = lazy(pageLoaders["/money"]);
const People = lazy(pageLoaders["/people"]);
const PersonDetail = lazy(pageLoaders["/people/:id"]);
const Groceries = lazy(pageLoaders["/groceries"]);
const Nutrition = lazy(pageLoaders["/nutrition"]);
const Fitness = lazy(pageLoaders["/fitness"]);
const Body = lazy(pageLoaders["/body"]);
const Tasks = lazy(pageLoaders["/tasks"]);
const CalendarPage = lazy(pageLoaders["/calendar"]);
const Settings = lazy(pageLoaders["/settings"]);
const Profile = lazy(pageLoaders["/profile"]);

/** Shown while the first sign-in check is under way. If the server cannot be reached it says so, and keeps trying. */
function Waiting({ shell = false }) {
  const { unreachable } = useAuth();
  if (shell && hasSessionHint()) {
    return <BootSkeleton note={unreachable && <p role="status" data-testid="server-unreachable" className="px-6 pt-4 text-sm text-slate-700 dark:text-slate-300">Can't reach the server right now. Trying again…</p>} />;
  }
  return (
    <div className="min-h-screen bg-background grid place-items-center p-6 text-center">
      {unreachable && (
        <p role="status" data-testid="server-unreachable" className="text-sm text-slate-700 dark:text-slate-300">
          Can't reach the server right now. Trying again…
        </p>
      )}
    </div>
  );
}

function Protected() {
  const { user, ready } = useAuth();
  if (!ready) return <Waiting shell />;
  if (!user) return <Navigate to="/login" replace />;
  return <AppShell><Suspense fallback={<RouteSkeleton />}><Outlet /></Suspense></AppShell>;
}

function PublicOnly() {
  const { user, ready } = useAuth();
  if (!ready) return <Waiting />;
  if (user?.email_verified) return <Navigate to="/" replace />;
  return <Outlet />;
}

export default function App() {
  return (
    <SettingsProvider>
      <AuthProvider>
        <TooltipProvider delayDuration={250}>
        <Toaster />
        <BrowserRouter>
          <Routes>
            <Route element={<PublicOnly />}>
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<Signup />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
            </Route>
            {/* Reachable while signed in too: the emailed link must work in whichever browser it is opened. */}
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route element={<Protected />}>
              <Route path="/" element={<Home />} />
              <Route path="/money" element={<Money />} />
              <Route path="/people" element={<People />} />
              <Route path="/people/:id" element={<PersonDetail />} />
              <Route path="/groceries" element={<Groceries />} />
              <Route path="/nutrition" element={<Nutrition />} />
              <Route path="/fitness" element={<Fitness />} />
              <Route path="/body" element={<Body />} />
              <Route path="/tasks" element={<Tasks />} />
              <Route path="/calendar" element={<CalendarPage />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/profile" element={<Profile />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
        </TooltipProvider>
      </AuthProvider>
    </SettingsProvider>
  );
}
