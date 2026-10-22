import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Eye, EyeOff, Lock, Mail, Loader2, KeyRound, X } from 'lucide-react';

export const Login: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Forgot password modal
  const [forgotModalOpen, setForgotModalOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);

  const { login, resetPassword, currentUser, adminProfile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // If already logged in as admin, redirect to home
  if (currentUser && adminProfile) {
    const from = (location.state as any)?.from?.pathname || '/';
    navigate(from, { replace: true });
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setErrorMsg('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Login failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotEmail) return;
    setForgotLoading(true);
    try {
      await resetPassword(forgotEmail);
      setForgotSent(true);
    } catch {
      // Error is caught and shown by toast
    } finally {
      setForgotLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-amber-50 via-white to-amber-100/40 dark:from-zinc-950 dark:via-zinc-900 dark:to-zinc-950 transition-colors">
      <div className="w-full max-w-md bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl shadow-2xl p-8 backdrop-blur-md relative overflow-hidden">
        {/* Glow accent */}
        <div className="absolute -top-24 -right-24 w-48 h-48 bg-amber-400/20 rounded-full blur-3xl pointer-events-none" />

        {/* Brand Header */}
        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-amber-400 text-black font-black text-3xl flex items-center justify-center shadow-lg shadow-amber-400/30 mb-4 border-2 border-amber-300">
            D
          </div>
          <h1 className="text-2xl font-black text-gray-900 dark:text-white tracking-tight">
            Delivio <span className="text-amber-500">Admin</span>
          </h1>
          <p className="text-sm text-gray-500 dark:text-zinc-400 mt-1">
            Platform Operations & Management Console
          </p>
        </div>

        {errorMsg && (
          <div className="mb-6 p-4 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 text-red-600 dark:text-red-400 text-xs font-semibold leading-relaxed">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">
              Admin Email
            </label>
            <div className="relative">
              <Mail className="w-5 h-5 text-gray-400 absolute left-3.5 top-3" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="admin@delivio.app"
                className="w-full pl-11 pr-4 py-3 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800/80 text-gray-900 dark:text-white text-sm focus:outline-hidden focus:ring-2 focus:ring-amber-400 transition-all placeholder:text-gray-400"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-bold text-gray-700 dark:text-zinc-300 uppercase tracking-wider">
                Password
              </label>
              <button
                type="button"
                onClick={() => {
                  setForgotEmail(email);
                  setForgotSent(false);
                  setForgotModalOpen(true);
                }}
                className="text-xs text-amber-600 dark:text-amber-400 font-semibold hover:underline"
              >
                Forgot password?
              </button>
            </div>
            <div className="relative">
              <Lock className="w-5 h-5 text-gray-400 absolute left-3.5 top-3" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="••••••••••••"
                className="w-full pl-11 pr-11 py-3 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800/80 text-gray-900 dark:text-white text-sm focus:outline-hidden focus:ring-2 focus:ring-amber-400 transition-all placeholder:text-gray-400"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3.5 top-3 text-gray-400 hover:text-gray-600 dark:hover:text-zinc-300"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 delivio-btn-yellow py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 shadow-lg shadow-amber-400/20 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Log In to Console'}
          </button>
        </form>

        <div className="mt-8 pt-6 border-t border-gray-100 dark:border-zinc-800 text-center">
          <p className="text-xs text-gray-400 dark:text-zinc-500">
            Authorized personnel only. All access attempts are logged for security.
          </p>
        </div>
      </div>

      {/* Forgot Password Modal */}
      {forgotModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-sm bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-6 shadow-2xl relative">
            <button
              onClick={() => setForgotModalOpen(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-zinc-300"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="p-2.5 rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400">
                <KeyRound className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-gray-900 dark:text-white text-base">Reset Password</h3>
            </div>

            {forgotSent ? (
              <div className="space-y-4">
                <p className="text-sm text-gray-600 dark:text-zinc-300 leading-relaxed">
                  A password reset link has been dispatched to <strong>{forgotEmail}</strong>. Check your inbox and follow the instructions.
                </p>
                <button
                  onClick={() => setForgotModalOpen(false)}
                  className="w-full delivio-btn-yellow py-2.5 rounded-xl text-sm font-bold"
                >
                  Done
                </button>
              </div>
            ) : (
              <form onSubmit={handleForgotSubmit} className="space-y-4">
                <p className="text-xs text-gray-500 dark:text-zinc-400">
                  Enter your admin account email and we'll send you a password reset link.
                </p>
                <div>
                  <input
                    type="email"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    required
                    placeholder="admin@delivio.app"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white text-sm focus:outline-hidden focus:ring-2 focus:ring-amber-400"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setForgotModalOpen(false)}
                    className="px-4 py-2 text-sm text-gray-600 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-xl"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={forgotLoading}
                    className="delivio-btn-yellow px-4 py-2 text-sm font-bold rounded-xl flex items-center gap-2 disabled:opacity-50"
                  >
                    {forgotLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                    Send Reset Link
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
