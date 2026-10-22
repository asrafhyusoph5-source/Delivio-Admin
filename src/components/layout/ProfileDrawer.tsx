import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  User,
  Phone,
  Mail,
  Camera,
  KeyRound,
  LogOut,
  Moon,
  Sun,
  Shield,
  ExternalLink,
  Loader2,
  Check,
  Settings,
  Bell,
  Activity
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { useNavigate } from 'react-router-dom';

interface ProfileDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ProfileDrawer: React.FC<ProfileDrawerProps> = ({ isOpen, onClose }) => {
  const { adminProfile, updateProfileDetails, changeAdminPassword, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  // Form states for profile edit
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  // Form states for change password
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  // Active tab inside drawer: 'profile' | 'security'
  const [activeTab, setActiveTab] = useState<'profile' | 'security'>('profile');

  // Touch gesture support: swipe right to close
  const touchStartXRef = useRef<number | null>(null);

  useEffect(() => {
    if (adminProfile) {
      setName(adminProfile.name || '');
      setPhone(adminProfile.phone || '');
      setPhotoUrl(adminProfile.photoUrl || '');
    }
  }, [adminProfile, isOpen]);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartXRef.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartXRef.current === null) return;
    const diff = e.changedTouches[0].clientX - touchStartXRef.current;
    // If swiped right more than 60px, close drawer
    if (diff > 60) {
      onClose();
    }
    touchStartXRef.current = null;
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      setSavingProfile(true);
      await updateProfileDetails({
        name: name.trim(),
        phone: phone.trim(),
        photoUrl: photoUrl.trim()
      });
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess(false);

    if (newPassword.length < 6) {
      setPasswordError('New password must be at least 6 characters long.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match.');
      return;
    }

    try {
      setChangingPassword(true);
      await changeAdminPassword(currentPassword, newPassword);
      setPasswordSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => setPasswordSuccess(false), 4000);
    } catch (err: any) {
      setPasswordError(err?.message || 'Failed to update password');
    } finally {
      setChangingPassword(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 overflow-hidden"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-xs transition-opacity animate-in fade-in duration-200"
        onClick={onClose}
      />

      <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
        <aside
          className="w-screen max-w-md bg-white dark:bg-zinc-950 border-l border-gray-200 dark:border-zinc-800 shadow-2xl flex flex-col transform transition ease-in-out duration-300 animate-in slide-in-from-right"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="p-5 border-b border-gray-100 dark:border-zinc-850 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-400 text-black font-extrabold flex items-center justify-center overflow-hidden shadow-xs">
                {photoUrl ? (
                  <img src={photoUrl} alt="Admin" className="w-full h-full object-cover" />
                ) : (
                  <User className="w-5 h-5 text-black" />
                )}
              </div>
              <div>
                <h3 className="font-bold text-gray-900 dark:text-white text-base">
                  {adminProfile?.name || 'Administrator'}
                </h3>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-400">
                  <Shield className="w-3 h-3" /> Master Admin
                </span>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-zinc-200 rounded-xl"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-gray-200 dark:border-zinc-800 px-5 pt-2">
            <button
              onClick={() => setActiveTab('profile')}
              className={`pb-3 text-sm font-semibold border-b-2 mr-6 transition-colors ${
                activeTab === 'profile'
                  ? 'border-amber-500 text-amber-600 dark:text-amber-400'
                  : 'border-transparent text-gray-500 dark:text-zinc-400 hover:text-gray-800'
              }`}
            >
              Profile Info
            </button>
            <button
              onClick={() => setActiveTab('security')}
              className={`pb-3 text-sm font-semibold border-b-2 transition-colors ${
                activeTab === 'security'
                  ? 'border-amber-500 text-amber-600 dark:text-amber-400'
                  : 'border-transparent text-gray-500 dark:text-zinc-400 hover:text-gray-800'
              }`}
            >
              Security & Password
            </button>
          </div>

          {/* Drawer Body */}
          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            {activeTab === 'profile' ? (
              <form onSubmit={handleSaveProfile} className="space-y-4">
                {/* Email Read-only */}
                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-zinc-400 uppercase tracking-wider mb-1">
                    Email Address (Read-Only)
                  </label>
                  <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-900 text-gray-500 dark:text-zinc-400 text-sm">
                    <Mail className="w-4 h-4 text-gray-400" />
                    <span>{adminProfile?.email}</span>
                  </div>
                </div>

                {/* Name */}
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-zinc-300 uppercase tracking-wider mb-1">
                    Display Name
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      className="w-full pl-3.5 pr-4 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-850 text-gray-900 dark:text-white text-sm focus:outline-hidden focus:ring-2 focus:ring-amber-400"
                    />
                  </div>
                </div>

                {/* Phone */}
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-zinc-300 uppercase tracking-wider mb-1">
                    Contact Phone
                  </label>
                  <div className="relative">
                    <Phone className="w-4 h-4 text-gray-400 absolute left-3.5 top-3" />
                    <input
                      type="text"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+63 9XX XXX XXXX"
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-850 text-gray-900 dark:text-white text-sm focus:outline-hidden focus:ring-2 focus:ring-amber-400"
                    />
                  </div>
                </div>

                {/* Photo URL */}
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-zinc-300 uppercase tracking-wider mb-1">
                    Avatar Photo URL
                  </label>
                  <div className="relative">
                    <Camera className="w-4 h-4 text-gray-400 absolute left-3.5 top-3" />
                    <input
                      type="url"
                      value={photoUrl}
                      onChange={(e) => setPhotoUrl(e.target.value)}
                      placeholder="https://example.com/photo.jpg"
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-850 text-gray-900 dark:text-white text-sm focus:outline-hidden focus:ring-2 focus:ring-amber-400"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={savingProfile}
                  className="w-full flex items-center justify-center gap-2 delivio-btn-yellow py-2.5 rounded-xl text-sm font-bold shadow-md shadow-amber-500/20 disabled:opacity-50 transition-all"
                >
                  {savingProfile ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                  Save Profile Changes
                </button>
              </form>
            ) : (
              <form onSubmit={handleChangePassword} className="space-y-4">
                <p className="text-xs text-gray-500 dark:text-zinc-400">
                  To change your admin password, first verify your current password for security.
                </p>

                {passwordError && (
                  <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 text-xs">
                    {passwordError}
                  </div>
                )}

                {passwordSuccess && (
                  <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-emerald-600 dark:text-emerald-400 text-xs font-semibold flex items-center gap-2">
                    <Check className="w-4 h-4" /> Password changed successfully!
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-zinc-300 uppercase tracking-wider mb-1">
                    Current Password
                  </label>
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    required
                    placeholder="••••••••"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-850 text-gray-900 dark:text-white text-sm focus:outline-hidden focus:ring-2 focus:ring-amber-400"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-zinc-300 uppercase tracking-wider mb-1">
                    New Password
                  </label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    placeholder="At least 6 characters"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-850 text-gray-900 dark:text-white text-sm focus:outline-hidden focus:ring-2 focus:ring-amber-400"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-zinc-300 uppercase tracking-wider mb-1">
                    Confirm New Password
                  </label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    placeholder="Repeat new password"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-850 text-gray-900 dark:text-white text-sm focus:outline-hidden focus:ring-2 focus:ring-amber-400"
                  />
                </div>

                <button
                  type="submit"
                  disabled={changingPassword}
                  className="w-full flex items-center justify-center gap-2 delivio-btn-yellow py-2.5 rounded-xl text-sm font-bold shadow-md shadow-amber-500/20 disabled:opacity-50"
                >
                  {changingPassword ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <KeyRound className="w-4 h-4" />
                  )}
                  Update Password
                </button>
              </form>
            )}

            {/* Quick Links Section */}
            <div className="pt-4 border-t border-gray-100 dark:border-zinc-850 space-y-2">
              <span className="text-xs font-bold uppercase tracking-wider text-gray-400 dark:text-zinc-500">
                Quick Shortcuts
              </span>

              <button
                onClick={() => {
                  onClose();
                  navigate('/settings');
                }}
                className="w-full flex items-center justify-between p-3 rounded-xl bg-gray-50 dark:bg-zinc-900 hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors text-sm text-gray-800 dark:text-zinc-200 font-medium"
              >
                <div className="flex items-center gap-3">
                  <Settings className="w-4 h-4 text-amber-500" />
                  <span>Platform Settings</span>
                </div>
                <ExternalLink className="w-4 h-4 text-gray-400" />
              </button>

              <button
                onClick={() => {
                  onClose();
                  navigate('/audit');
                }}
                className="w-full flex items-center justify-between p-3 rounded-xl bg-gray-50 dark:bg-zinc-900 hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors text-sm text-gray-800 dark:text-zinc-200 font-medium"
              >
                <div className="flex items-center gap-3">
                  <Activity className="w-4 h-4 text-amber-500" />
                  <span>Security Audit Log</span>
                </div>
                <ExternalLink className="w-4 h-4 text-gray-400" />
              </button>

              <button
                onClick={() => {
                  onClose();
                  navigate('/notifications');
                }}
                className="w-full flex items-center justify-between p-3 rounded-xl bg-gray-50 dark:bg-zinc-900 hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors text-sm text-gray-800 dark:text-zinc-200 font-medium"
              >
                <div className="flex items-center gap-3">
                  <Bell className="w-4 h-4 text-amber-500" />
                  <span>Notifications Center</span>
                </div>
                <ExternalLink className="w-4 h-4 text-gray-400" />
              </button>
            </div>

            {/* Theme Toggle within Drawer */}
            <div className="pt-2">
              <button
                onClick={toggleTheme}
                className="w-full flex items-center justify-between p-3 rounded-xl border border-gray-200 dark:border-zinc-800 hover:bg-gray-50 dark:hover:bg-zinc-900 transition-colors text-sm text-gray-800 dark:text-zinc-200 font-medium"
              >
                <div className="flex items-center gap-3">
                  {theme === 'dark' ? (
                    <Sun className="w-4 h-4 text-amber-400" />
                  ) : (
                    <Moon className="w-4 h-4 text-gray-500" />
                  )}
                  <span>Appearance: {theme === 'dark' ? 'Dark Mode' : 'Light Mode'}</span>
                </div>
                <span className="text-xs text-amber-600 dark:text-amber-400 font-bold">Toggle</span>
              </button>
            </div>
          </div>

          {/* Drawer Footer with Log Out */}
          <div className="p-5 border-t border-gray-100 dark:border-zinc-850">
            <button
              onClick={async () => {
                onClose();
                await logout();
              }}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-950/40 text-sm font-bold transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Log Out of Delivio Admin
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
};
