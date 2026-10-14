import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { SettingsProvider } from "@/context/SettingsContext";
import { AppShell } from "@/components/AppShell";
import Login from "@/pages/Login";
import Signup from "@/pages/Signup";
import ForgotPassword from "@/pages/ForgotPassword";
import ResetPassword from "@/pages/ResetPassword";
import Home from "@/pages/Home";
import Money from "@/pages/Money";
import People from "@/pages/People";
import PersonDetail from "@/pages/PersonDetail";
import Tasks from "@/pages/Tasks";
import Body from "@/pages/Body";
import Groceries from "@/pages/Groceries";
import Nutrition from "@/pages/Nutrition";
import Fitness from "@/pages/Fitness";
import CalendarPage from "@/pages/Calendar";
import Settings from "@/pages/Settings";

function Protected() {
  const { user, ready } = useAuth();
  if (!ready) return <div className="min-h-screen bg-background" />;
  if (!user) return <Navigate to="/login" replace />;
  return <AppShell><Outlet /></AppShell>;
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
        <Toaster position="top-center" richColors closeButton />
        <BrowserRouter>
          <Routes>
            <Route element={<PublicOnly />}>
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<Signup />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
            </Route>
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
      </AuthProvider>
    </SettingsProvider>
  );
}
