import { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Sparkles, ArrowLeft, Loader2, Mail, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export default function ForgotPassword() {
  const { forgotPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await forgotPassword(email.trim());
      setSent(true);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not request reset.");
    } finally {
      setLoading(false);
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
            Reset your password — <span className="text-emerald-400">safely and quickly.</span>
          </h1>
        </motion.div>
        <p className="text-xs text-slate-500 relative">Private • Secure • Built for you</p>
      </div>

      <div className="flex items-center justify-center p-8">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <div className="h-9 w-9 rounded-xl bg-emerald-600 grid place-items-center text-white"><Sparkles className="h-5 w-5" /></div>
            <span className="font-bold text-lg">Life Record</span>
          </div>

          <Link to="/login" className="inline-flex items-center text-sm font-medium text-emerald-600 hover:text-emerald-700 mb-6">
            <ArrowLeft className="h-4 w-4 mr-1" /> Back to sign in
          </Link>

          {!sent ? (
            <>
              <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">Forgot password?</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Enter your email and we&apos;ll send you a reset link.</p>
              <form onSubmit={submit} className="mt-8 space-y-4">
                <div>
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Email</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className="mt-1.5 h-11 pl-10" required />
                  </div>
                </div>
                <Button type="submit" disabled={loading} className="w-full h-11 mt-6 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold">
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send reset link"}
                </Button>
              </form>
            </>
          ) : (
            <div className="text-center">
              <div className="mx-auto h-12 w-12 rounded-full bg-emerald-100 dark:bg-emerald-900/30 grid place-items-center">
                <CheckCircle2 className="h-6 w-6 text-emerald-600" />
              </div>
              <h2 className="mt-4 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">Check your inbox</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
                If an account exists for <span className="font-medium text-slate-700 dark:text-slate-300">{email}</span>, you will receive a password reset link.
              </p>
              <Link to="/login" className="mt-6 inline-block text-sm font-semibold text-emerald-600 hover:text-emerald-700">Return to sign in</Link>
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}
