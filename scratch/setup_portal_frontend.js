const fs = require('fs');
const path = require('path');

const portalDir = path.resolve(__dirname, '..', '..', 'dnc-portal');

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function writeFile(relPath, content) {
  const fullPath = path.join(portalDir, relPath);
  ensureDir(fullPath);
  fs.writeFileSync(fullPath, content.trim() + '\n', 'utf8');
  console.log('Created:', relPath);
}

// 1. src/app/login/page.js
writeFile('src/app/login/page.js', `
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Shield, Lock, User, ArrowRight, AlertCircle, CheckCircle2 } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLogin(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Login failed');
      }

      if (data.user.role !== 'admin') {
        throw new Error('This portal is reserved for administrators only.');
      }

      localStorage.setItem('dnc_admin_token', data.token);
      localStorage.setItem('dnc_admin_user', JSON.stringify(data.user));
      router.push('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 relative overflow-hidden font-sans">
      {/* Dynamic ambient glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-indigo-600/20 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-10 right-10 w-80 h-80 bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-md bg-slate-900/80 backdrop-blur-xl border border-slate-800/80 rounded-2xl shadow-2xl p-8 z-10">
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-indigo-600 to-blue-500 flex items-center justify-center shadow-lg shadow-indigo-500/25 mb-4 border border-indigo-400/30">
            <Shield className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">DNC Compliance Admin</h1>
          <p className="text-sm text-slate-400 mt-1">Sign in to manage licenses & lookup quotas</p>
        </div>

        {error && (
          <div className="mb-6 p-3.5 bg-red-500/10 border border-red-500/30 rounded-xl flex items-start gap-3 text-red-400 text-sm">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-5">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-2">
              Admin Username
            </label>
            <div className="relative">
              <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. MUadmin"
                required
                className="w-full pl-10 pr-4 py-2.5 bg-slate-950/60 border border-slate-800 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-2">
              Password
            </label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full pl-10 pr-4 py-2.5 bg-slate-950/60 border border-slate-800 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 px-4 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white font-medium rounded-xl text-sm flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/30 transition-all cursor-pointer disabled:opacity-50"
          >
            {loading ? (
              <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <span>Sign In to Dashboard</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        <div className="mt-8 pt-6 border-t border-slate-800/80 text-center">
          <p className="text-xs text-slate-500">
            Initial Admin: <span className="text-slate-300 font-mono">MUadmin</span> | Default: <span className="text-slate-300 font-mono">umadmin</span>
          </p>
        </div>
      </div>
    </div>
  );
}
`);

// 2. src/app/page.js
writeFile('src/app/page.js', `
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Shield,
  Users,
  Search,
  Plus,
  RefreshCw,
  LogOut,
  Sliders,
  CheckCircle,
  XCircle,
  AlertTriangle,
  KeyRound,
  Trash2,
  TrendingUp,
  UserCheck,
  CreditCard,
  X,
  Layers,
  Activity
} from 'lucide-react';

export default function AdminDashboard() {
  const router = useRouter();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [adminUser, setAdminUser] = useState(null);

  // Modals state
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isCreditOpen, setIsCreditOpen] = useState(false);
  const [isPasswordOpen, setIsPasswordOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);

  // Form states
  const [newUserData, setNewUserData] = useState({
    username: '',
    password: '',
    displayName: '',
    planName: 'Starter',
    lookupLimit: 500,
    notes: '',
  });
  const [addCreditsAmount, setAddCreditsAmount] = useState(500);
  const [newPassword, setNewPassword] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');

  const getToken = () => localStorage.getItem('dnc_admin_token');

  useEffect(() => {
    const token = getToken();
    const storedUser = localStorage.getItem('dnc_admin_user');
    if (!token) {
      router.push('/login');
      return;
    }
    if (storedUser) {
      setAdminUser(JSON.parse(storedUser));
    }
    fetchUsers();
  }, []);

  async function fetchUsers() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/users', {
        headers: { Authorization: 'Bearer ' + getToken() },
      });
      if (res.status === 401 || res.status === 403) {
        localStorage.removeItem('dnc_admin_token');
        router.push('/login');
        return;
      }
      const data = await res.json();
      if (data.success) {
        setUsers(data.users || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  function handleLogout() {
    localStorage.removeItem('dnc_admin_token');
    localStorage.removeItem('dnc_admin_user');
    router.push('/login');
  }

  // Create User
  async function handleCreateUser(e) {
    e.preventDefault();
    setActionError('');
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + getToken(),
        },
        body: JSON.stringify(newUserData),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create customer');

      setIsCreateOpen(false);
      setNewUserData({
        username: '',
        password: '',
        displayName: '',
        planName: 'Starter',
        lookupLimit: 500,
        notes: '',
      });
      setActionSuccess('User ' + data.user.username + ' created successfully!');
      setTimeout(() => setActionSuccess(''), 4000);
      fetchUsers();
    } catch (err) {
      setActionError(err.message);
    }
  }

  // Add Credits
  async function handleAddCredits(e) {
    e.preventDefault();
    if (!selectedUser) return;
    setActionError('');
    try {
      const res = await fetch('/api/admin/users/' + selectedUser._id, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + getToken(),
        },
        body: JSON.stringify({ addLookups: parseInt(addCreditsAmount, 10) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update credits');

      setIsCreditOpen(false);
      setActionSuccess('Added ' + addCreditsAmount + ' lookups to ' + selectedUser.username);
      setTimeout(() => setActionSuccess(''), 4000);
      fetchUsers();
    } catch (err) {
      setActionError(err.message);
    }
  }

  // Reset Password
  async function handleResetPassword(e) {
    e.preventDefault();
    if (!selectedUser) return;
    setActionError('');
    try {
      const res = await fetch('/api/admin/users/' + selectedUser._id, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + getToken(),
        },
        body: JSON.stringify({ password: newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to reset password');

      setIsPasswordOpen(false);
      setNewPassword('');
      setActionSuccess('Password updated for ' + selectedUser.username);
      setTimeout(() => setActionSuccess(''), 4000);
    } catch (err) {
      setActionError(err.message);
    }
  }

  // Toggle Active
  async function handleToggleStatus(user) {
    try {
      const res = await fetch('/api/admin/users/' + user._id, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + getToken(),
        },
        body: JSON.stringify({ isActive: !user.isActive }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update status');
      fetchUsers();
    } catch (err) {
      alert(err.message);
    }
  }

  // Delete User
  async function handleDeleteUser(user) {
    if (!confirm('Are you sure you want to delete ' + user.username + '?')) return;
    try {
      const res = await fetch('/api/admin/users/' + user._id, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer ' + getToken() },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete user');
      fetchUsers();
    } catch (err) {
      alert(err.message);
    }
  }

  // Metrics
  const totalCustomers = users.filter((u) => u.role !== 'admin').length;
  const activeCustomers = users.filter((u) => u.role !== 'admin' && u.isActive && u.lookupsRemaining > 0).length;
  const quotaReachedCount = users.filter((u) => u.role !== 'admin' && u.lookupsRemaining <= 0).length;
  const totalLookupsUsed = users.reduce((acc, u) => acc + (u.totalLookupsUsed || 0), 0);

  const filteredUsers = users.filter((u) => {
    const term = search.toLowerCase();
    return (
      u.username.toLowerCase().includes(term) ||
      (u.displayName && u.displayName.toLowerCase().includes(term)) ||
      (u.planName && u.planName.toLowerCase().includes(term))
    );
  });

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans">
      {/* Top Navbar */}
      <header className="sticky top-0 z-30 bg-slate-900/80 backdrop-blur-md border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-blue-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white tracking-tight leading-none">DNC License Manager</h1>
            <p className="text-xs text-slate-400 mt-1">Chrome Extension Auth & Lookup Quota Portal</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700/60 text-xs text-slate-300">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Admin: <strong>{adminUser?.username || 'MUadmin'}</strong></span>
          </div>

          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-red-500/20 hover:text-red-400 text-slate-300 text-xs font-medium border border-slate-700/60 transition-all cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Logout</span>
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* Alerts */}
        {actionSuccess && (
          <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-center gap-3 text-emerald-400 text-sm">
            <CheckCircle className="w-5 h-5 flex-shrink-0" />
            <span>{actionSuccess}</span>
          </div>
        )}

        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Total Customers</p>
              <p className="text-2xl font-bold text-white mt-1">{totalCustomers}</p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center">
              <Users className="w-6 h-6" />
            </div>
          </div>

          <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Active with Credits</p>
              <p className="text-2xl font-bold text-emerald-400 mt-1">{activeCustomers}</p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
              <UserCheck className="w-6 h-6" />
            </div>
          </div>

          <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Quota Depleted</p>
              <p className="text-2xl font-bold text-amber-400 mt-1">{quotaReachedCount}</p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center">
              <AlertTriangle className="w-6 h-6" />
            </div>
          </div>

          <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Total Lookups Done</p>
              <p className="text-2xl font-bold text-blue-400 mt-1">{totalLookupsUsed.toLocaleString()}</p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-blue-500/10 text-blue-400 flex items-center justify-center">
              <Activity className="w-6 h-6" />
            </div>
          </div>
        </div>

        {/* Action Bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="relative w-full sm:w-80">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search by username, name, plan..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-slate-900/90 border border-slate-800 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
            />
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
            <button
              onClick={fetchUsers}
              disabled={loading}
              className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 text-sm transition-all cursor-pointer"
              title="Refresh"
            >
              <RefreshCw className={'w-4 h-4 ' + (loading ? 'animate-spin' : '')} />
            </button>

            <button
              onClick={() => {
                setActionError('');
                setIsCreateOpen(true);
              }}
              className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white font-medium rounded-xl text-sm shadow-lg shadow-indigo-600/25 transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Create Customer Account</span>
            </button>
          </div>
        </div>

        {/* Customers Table */}
        <div className="bg-slate-900/70 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="bg-slate-950/60 border-b border-slate-800 text-xs uppercase tracking-wider text-slate-400 font-semibold">
                <tr>
                  <th className="py-3.5 px-6">Customer / User</th>
                  <th className="py-3.5 px-6">Plan</th>
                  <th className="py-3.5 px-6">Remaining Quota</th>
                  <th className="py-3.5 px-6">Lookups Used</th>
                  <th className="py-3.5 px-6">Status</th>
                  <th className="py-3.5 px-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {loading ? (
                  <tr>
                    <td colSpan="6" className="py-12 text-center text-slate-500">
                      <div className="inline-block w-6 h-6 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin mb-2" />
                      <p>Loading accounts...</p>
                    </td>
                  </tr>
                ) : filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="py-12 text-center text-slate-500">
                      No accounts found. Click "Create Customer Account" to add the first user.
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((u) => {
                    const isLimitReached = u.lookupsRemaining <= 0;
                    return (
                      <tr key={u._id} className="hover:bg-slate-800/30 transition-colors">
                        <td className="py-4 px-6">
                          <div className="font-medium text-white flex items-center gap-2">
                            <span>{u.username}</span>
                            {u.role === 'admin' && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                                ADMIN
                              </span>
                            )}
                          </div>
                          {u.displayName && <p className="text-xs text-slate-400">{u.displayName}</p>}
                        </td>

                        <td className="py-4 px-6 text-slate-300">
                          <span className="px-2.5 py-1 rounded-lg bg-slate-800/90 border border-slate-700/60 text-xs">
                            {u.planName || 'Standard'}
                          </span>
                        </td>

                        <td className="py-4 px-6">
                          {u.role === 'admin' ? (
                            <span className="text-emerald-400 font-semibold text-xs">Unlimited</span>
                          ) : (
                            <div>
                              <div className="flex items-center gap-2 font-mono text-sm">
                                <span className={isLimitReached ? 'text-red-400 font-bold' : 'text-emerald-400 font-semibold'}>
                                  {u.lookupsRemaining.toLocaleString()}
                                </span>
                                <span className="text-slate-500">/</span>
                                <span className="text-slate-400">{u.lookupsTotal.toLocaleString()}</span>
                              </div>
                              <div className="w-28 h-1.5 bg-slate-800 rounded-full overflow-hidden mt-1.5">
                                <div
                                  className={'h-full rounded-full ' + (isLimitReached ? 'bg-red-500' : 'bg-emerald-500')}
                                  style={{
                                    width: Math.min(100, Math.round((u.lookupsRemaining / (u.lookupsTotal || 1)) * 100)) + '%',
                                  }}
                                />
                              </div>
                            </div>
                          )}
                        </td>

                        <td className="py-4 px-6 font-mono text-slate-400 text-sm">
                          {(u.totalLookupsUsed || 0).toLocaleString()}
                        </td>

                        <td className="py-4 px-6">
                          {!u.isActive ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20">
                              <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                              Disabled
                            </span>
                          ) : isLimitReached && u.role !== 'admin' ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                              Limit Reached
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                              Active
                            </span>
                          )}
                        </td>

                        <td className="py-4 px-6 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {u.role !== 'admin' && (
                              <button
                                onClick={() => {
                                  setSelectedUser(u);
                                  setAddCreditsAmount(500);
                                  setActionError('');
                                  setIsCreditOpen(true);
                                }}
                                className="px-2.5 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 text-xs font-medium border border-indigo-500/30 transition-all cursor-pointer flex items-center gap-1"
                                title="Add Lookups"
                              >
                                <Plus className="w-3.5 h-3.5" />
                                <span>Add Quota</span>
                              </button>
                            )}

                            <button
                              onClick={() => {
                                setSelectedUser(u);
                                setNewPassword('');
                                setActionError('');
                                setIsPasswordOpen(true);
                              }}
                              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all cursor-pointer"
                              title="Reset Password"
                            >
                              <KeyRound className="w-4 h-4" />
                            </button>

                            <button
                              onClick={() => handleToggleStatus(u)}
                              className={'p-1.5 rounded-lg transition-all cursor-pointer ' + (u.isActive ? 'bg-slate-800 hover:bg-amber-500/20 text-slate-300 hover:text-amber-400' : 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30')}
                              title={u.isActive ? 'Deactivate Account' : 'Activate Account'}
                            >
                              {u.isActive ? <XCircle className="w-4 h-4" /> : <CheckCircle className="w-4 h-4" />}
                            </button>

                            {u.role !== 'admin' && (
                              <button
                                onClick={() => handleDeleteUser(u)}
                                className="p-1.5 rounded-lg bg-slate-800 hover:bg-red-500/20 text-slate-400 hover:text-red-400 transition-all cursor-pointer"
                                title="Delete User"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* CREATE USER MODAL */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Plus className="w-5 h-5 text-indigo-400" />
                <span>Create New Customer Account</span>
              </h2>
              <button onClick={() => setIsCreateOpen(false)} className="text-slate-400 hover:text-white cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            {actionError && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-xs">
                {actionError}
              </div>
            )}

            <form onSubmit={handleCreateUser} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                    Username *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. client1"
                    value={newUserData.username}
                    onChange={(e) => setNewUserData({ ...newUserData, username: e.target.value })}
                    className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                    Password *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. pass123"
                    value={newUserData.password}
                    onChange={(e) => setNewUserData({ ...newUserData, password: e.target.value })}
                    className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                    Client / Business Name
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Acme Leads"
                    value={newUserData.displayName}
                    onChange={(e) => setNewUserData({ ...newUserData, displayName: e.target.value })}
                    className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                    Plan Name
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Starter (500)"
                    value={newUserData.planName}
                    onChange={(e) => setNewUserData({ ...newUserData, planName: e.target.value })}
                    className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                  Initial Lookup Limit (Credits) *
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min="1"
                    required
                    value={newUserData.lookupLimit}
                    onChange={(e) => setNewUserData({ ...newUserData, lookupLimit: e.target.value })}
                    className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 font-mono"
                  />
                  <div className="flex gap-1.5">
                    {[250, 500, 1000, 2500].map((preset) => (
                      <button
                        type="button"
                        key={preset}
                        onClick={() => setNewUserData({ ...newUserData, lookupLimit: preset })}
                        className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs rounded-lg text-slate-300 cursor-pointer"
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  When lookups reach 0, user is auto logged out in the extension with "limit reached contact admin for more limit".
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                  Internal Notes
                </label>
                <textarea
                  rows="2"
                  placeholder="Optional billing info or contact details..."
                  value={newUserData.notes}
                  onChange={(e) => setNewUserData({ ...newUserData, notes: e.target.value })}
                  className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-xl shadow-lg shadow-indigo-600/30 cursor-pointer"
                >
                  Create Customer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ADD CREDITS MODAL */}
      {isCreditOpen && selectedUser && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-indigo-400" />
                <span>Top Up Quota: {selectedUser.username}</span>
              </h2>
              <button onClick={() => setIsCreditOpen(false)} className="text-slate-400 hover:text-white cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            {actionError && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-xs">
                {actionError}
              </div>
            )}

            <form onSubmit={handleAddCredits} className="space-y-4">
              <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800/80 text-xs space-y-1 text-slate-400">
                <p>Current Remaining: <strong className="text-emerald-400">{selectedUser.lookupsRemaining}</strong></p>
                <p>Current Total Plan: <strong className="text-slate-200">{selectedUser.lookupsTotal}</strong></p>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                  Credits to Add
                </label>
                <input
                  type="number"
                  min="1"
                  required
                  value={addCreditsAmount}
                  onChange={(e) => setAddCreditsAmount(e.target.value)}
                  className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 font-mono"
                />
                <div className="flex gap-2 mt-2">
                  {[100, 250, 500, 1000].map((amt) => (
                    <button
                      type="button"
                      key={amt}
                      onClick={() => setAddCreditsAmount(amt)}
                      className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-xs rounded-lg text-slate-300 cursor-pointer"
                    >
                      +{amt}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsCreditOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-xl shadow-lg shadow-indigo-600/30 cursor-pointer"
                >
                  Confirm & Add Credits
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* RESET PASSWORD MODAL */}
      {isPasswordOpen && selectedUser && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-amber-400" />
                <span>Reset Password: {selectedUser.username}</span>
              </h2>
              <button onClick={() => setIsPasswordOpen(false)} className="text-slate-400 hover:text-white cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            {actionError && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-xs">
                {actionError}
              </div>
            )}

            <form onSubmit={handleResetPassword} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                  New Password *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Enter new password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsPasswordOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium rounded-xl shadow-lg shadow-amber-600/30 cursor-pointer"
                >
                  Update Password
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
`);

console.log('✅ Frontend admin UI pages created!');
