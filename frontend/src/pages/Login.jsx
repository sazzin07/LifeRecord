import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, ArrowRight, Loader2, Mail, Lock, ShieldCheck } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export default function Login() {
  const { login, verifyCode, resendVerification } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingUser, setPendingUser] = useState(null);
  const [code, setCode] = useState("");
  const [codeLoading, setCodeLoading] = useState(false);
  const [resendDisabled, setResendDisabled] = useState(true);
  const [resendTimer, setResendTimer] = useState(90);

  const startResendTimer = () => {
    setResendDisabled(true);
    setResendTimer(90);
    const interval = setInterval(() => {
      setResendTimer((t) => {
        if (t <= 1) {
          clearInterval(interval);
          setResendDisabled(false);
          return 0;
        }
        return t - 1;
      });
    }, 1000);
  };

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const result = await login(email.trim(), password);
      if (result?.requiresVerification) {
        setPendingUser(result.user);
        startResendTimer();
      } else {
        nav("/");
      }
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not sign in. Check your details.");
    } finally {
      setLoading(false);
    }
  };

  const verify = async (e) => {
    e.preventDefault();
    setCodeLoading(true);
    try {
      await verifyCode(pendingUser.email, code.trim());
      toast.success("Email verified. Welcome back!");
      nav("/");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not verify code.");
    } finally {
      setCodeLoading(false);
    }
  };

  const resend = async () => {
    try {
      await resendVerification(pendingUser.email);
      toast.success("A new verification code has been sent.");
      startResendTimer();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not resend code.");
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-background">
      <div className="hidden lg:flex flex-col justify-between p-12 bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950 text-white relative overflow-hidden">
        <div className="absolute -top-24 -right-24 h-96 w-96 rounded-full bg-emerald-500/20 blur-3xl" />
        <div className="flex items-center gap-2 relative">
          <div className="h-9 w-9 rounded-xl bg-emerald-500 grid place-items-center"><Sparkles className="h-5 w-5" /></div>
          <span className="font-bold text-lg tracking-tight">Life Record</span>
        </div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className="relative">
          <h1 className="text-4xl xl:text-5xl font-extrabold tracking-tight leading-tight">
            Your money, food, training and life — <span className="text-emerald-400">in one calm place.</span>
          </h1>
          <p className="mt-5 text-slate-300 max-w-md leading-relaxed">
            Type it, speak it or photograph it. Life Record turns raw moments into organised, connected insight.
          </p>
        </motion.div>
        <p className="text-xs text-slate-500 relative">Private • Secure • Built for you</p>
      </div>

      <div className="flex items-center justify-center p-8">
        <motion.form initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
          onSubmit={submit} className="w-full max-w-sm" data-testid="login-form">
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <div className="h-9 w-9 rounded-xl bg-emerald-600 grid place-items-center text-white"><Sparkles className="h-5 w-5" /></div>
            <span className="font-bold text-lg">Life Record</span>
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">Welcome back</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Sign in to your command center.</p>

          <div className="mt-8 space-y-4">
            <div>
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input data-testid="login-email" value={email} onChange={(e) => setEmail(e.target.value)} type="email" className="mt-1.5 h-11 pl-10" />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input data-testid="login-password" value={password} onChange={(e) => setPassword(e.target.value)} type="password" className="mt-1.5 h-11 pl-10" />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between mt-3">
            <Link to="/forgot-password" className="text-sm font-medium text-emerald-600 hover:text-emerald-700">Forgot password?</Link>
          </div>

          <Button data-testid="login-submit" type="submit" disabled={loading} className="w-full h-11 mt-6 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Enter <ArrowRight className="h-4 w-4 ml-1" /></>}
          </Button>

          <p className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">
            Don&apos;t have an account?{" "}
            <Link to="/signup" className="font-semibold text-emerald-600 hover:text-emerald-700">Create one</Link>
          </p>
        </motion.form>
      </div>

      <AnimatePresence>
        {pendingUser && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.96, opacity: 0 }}
              className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 p-6 shadow-2xl"
            >
              <div className="mx-auto h-12 w-12 rounded-full bg-emerald-100 dark:bg-emerald-900/30 grid place-items-center">
                <ShieldCheck className="h-6 w-6 text-emerald-600" />
              </div>
              <h3 className="mt-4 text-xl font-bold text-center text-slate-900 dark:text-slate-50">Verify your email</h3>
              <p className="mt-1 text-center text-sm text-slate-500 dark:text-slate-400">
                We sent a 6-digit code to <span className="font-medium text-slate-700 dark:text-slate-300">{pendingUser.email}</span>. Enter it below to continue.
              </p>

              <form onSubmit={verify} className="mt-6 space-y-4">
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="000000"
                  maxLength={6}
                  inputMode="numeric"
                  className="h-12 text-center text-2xl tracking-[0.5em] font-semibold"
                />
                <Button type="submit" disabled={codeLoading || code.length < 6} className="w-full h-11 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold">
                  {codeLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verify email"}
                </Button>
              </form>

              <div className="mt-4 text-center">
                <button
                  type="button"
                  onClick={resend}
                  disabled={resendDisabled}
                  className="text-sm font-medium text-emerald-600 hover:text-emerald-700 disabled:text-slate-400 disabled:cursor-not-allowed"
                >
                  {resendDisabled ? `Resend code in ${resendTimer}s` : "Resend code"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
