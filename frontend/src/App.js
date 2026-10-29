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

import { PageSkeleton } from "@/components/common";
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

function Protected() {
  const { user, ready } = useAuth();
  if (!ready) return <div className="min-h-screen bg-background" />;
  if (!user) return <Navigate to="/login" replace />;
  return <AppShell><Suspense fallback={<PageSkeleton />}><Outlet /></Suspense></AppShell>;
}

function PublicOnly() {
  const { user, ready } = useAuth();
  if (!ready) return <div className="min-h-screen bg-background" />;
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
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
        </TooltipProvider>
      </AuthProvider>
    </SettingsProvider>
  );
}
