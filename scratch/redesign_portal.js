const fs = require('fs');
const path = require('path');

const portalDir = path.resolve(__dirname, '..', '..', 'dnc-portal');

// 1. src/app/globals.css
const globalsCss = `@import "tailwindcss";

:root {
  --background: #ffffff;
  --foreground: #09090b;
}

body {
  background-color: #ffffff;
  color: #09090b;
  font-family: var(--font-geist-sans), -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

input, button, select, textarea {
  font-family: inherit;
}
`;
fs.writeFileSync(path.join(portalDir, 'src', 'app', 'globals.css'), globalsCss.trim() + '\n', 'utf8');
console.log('Updated globals.css');

// 2. src/app/login/page.js
const loginPage = `'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Shield, ArrowRight, AlertCircle, Lock, User } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
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
        throw new Error(data.error || 'Authentication failed');
      }

      if (data.user.role !== 'admin') {
        throw new Error('Access denied. Administrator privileges required.');
      }

      localStorage.setItem('dnc_admin_token', data.token);
      localStorage.setItem('dnc_admin_user', JSON.stringify(data.user));

      router.push('/');
    } catch (err) {
      setError(err.message || 'Failed to sign in. Please verify your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white flex flex-col justify-center items-center px-4 py-12 selection:bg-zinc-900 selection:text-white">
      <div className="w-full max-w-sm">
        {/* Brand Header */}
        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-zinc-950 text-white flex items-center justify-center mb-4 shadow-sm">
            <Shield className="w-6 h-6 stroke-[2]" />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-zinc-950">Auto Lookup</h1>
          <p className="text-sm text-zinc-500 mt-1">License & Quota Administration Portal</p>
        </div>

        {/* Login Box */}
        <div className="bg-white border border-zinc-200 rounded-2xl p-7 shadow-sm">
          {error && (
            <div className="mb-5 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs font-medium flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-700 uppercase tracking-wider mb-1.5">
                Username
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="admin"
                  autoComplete="username"
                  className="w-full bg-white border border-zinc-200 rounded-lg pl-9 pr-3 py-2 text-sm text-zinc-950 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-950 focus:border-zinc-950 transition-all"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-700 uppercase tracking-wider mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="w-full bg-white border border-zinc-200 rounded-lg pl-9 pr-3 py-2 text-sm text-zinc-950 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-950 focus:border-zinc-950 transition-all"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 bg-zinc-950 hover:bg-zinc-800 text-white font-medium py-2.5 px-4 rounded-lg text-sm transition-all duration-150 flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer shadow-sm"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <span>Sign In</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        </div>

        {/* Footer info */}
        <div className="text-center mt-6">
          <p className="text-xs text-zinc-400">
            Initial Admin: <span className="font-mono text-zinc-600 font-semibold">MUadmin</span> / <span className="font-mono text-zinc-600 font-semibold">umadmin</span>
          </p>
        </div>
      </div>
    </div>
  );
}
`;
fs.writeFileSync(path.join(portalDir, 'src', 'app', 'login', 'page.js'), loginPage.trim() + '\n', 'utf8');
console.log('Updated login/page.js');

// 3. src/app/page.js
const dashboardPage = `'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Shield,
  Search,
  Plus,
  RefreshCw,
  LogOut,
  CheckCircle2,
  XCircle,
  AlertCircle,
  KeyRound,
  Trash2,
  X,
  PlusCircle,
  TrendingUp,
  UserCheck,
  Zap,
  Users
} from 'lucide-react';

export default function AdminDashboard() {
  const router = useRouter();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'active' | 'exhausted'
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
    planName: 'Standard Plan',
    lookupLimit: 500,
    notes: '',
  });
  const [addCreditsAmount, setAddCreditsAmount] = useState(500);
  const [newPassword, setNewPassword] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');

  const getToken = () => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('dnc_admin_token');
    }
    return null;
  };

  useEffect(() => {
    const token = getToken();
    const storedUser = localStorage.getItem('dnc_admin_user');
    if (!token) {
      router.push('/login');
      return;
    }
    if (storedUser) {
      try {
        setAdminUser(JSON.parse(storedUser));
      } catch (e) {}
    }
    fetchUsers();
  }, []);

  const showNotification = (successMsg, errorMsg) => {
    if (successMsg) {
      setActionSuccess(successMsg);
      setActionError('');
      setTimeout(() => setActionSuccess(''), 4000);
    }
    if (errorMsg) {
      setActionError(errorMsg);
      setActionSuccess('');
      setTimeout(() => setActionError(''), 5000);
    }
  };

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const token = getToken();
      const res = await fetch('/api/admin/users', {
        headers: { Authorization: \`Bearer \${token}\` },
      });
      if (res.status === 401 || res.status === 403) {
        localStorage.removeItem('dnc_admin_token');
        router.push('/login');
        return;
      }
      const data = await res.json();
      if (data.users) {
        setUsers(data.users);
      }
    } catch (err) {
      showNotification('', 'Failed to fetch users list');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    setActionError('');
    try {
      const token = getToken();
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: \`Bearer \${token}\`,
        },
        body: JSON.stringify(newUserData),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create user');

      setIsCreateOpen(false);
      setNewUserData({
        username: '',
        password: '',
        displayName: '',
        planName: 'Standard Plan',
        lookupLimit: 500,
        notes: '',
      });
      showNotification(\`User "\${data.user.username}" created successfully with \${data.user.lookupsRemaining} lookups\`);
      fetchUsers();
    } catch (err) {
      setActionError(err.message);
    }
  };

  const handleAddCredits = async (e) => {
    e.preventDefault();
    if (!selectedUser) return;
    setActionError('');
    try {
      const token = getToken();
      const res = await fetch(\`/api/admin/users/\${selectedUser._id}\`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: \`Bearer \${token}\`,
        },
        body: JSON.stringify({ addLookups: Number(addCreditsAmount) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add credits');

      setIsCreditOpen(false);
      showNotification(\`Added \${addCreditsAmount} credits to \${selectedUser.username}. New balance: \${data.user.lookupsRemaining}\`);
      fetchUsers();
    } catch (err) {
      setActionError(err.message);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    if (!selectedUser || !newPassword) return;
    setActionError('');
    try {
      const token = getToken();
      const res = await fetch(\`/api/admin/users/\${selectedUser._id}\`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: \`Bearer \${token}\`,
        },
        body: JSON.stringify({ password: newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to reset password');

      setIsPasswordOpen(false);
      setNewPassword('');
      showNotification(\`Password reset successfully for \${selectedUser.username}\`);
    } catch (err) {
      setActionError(err.message);
    }
  };

  const handleToggleStatus = async (user) => {
    try {
      const token = getToken();
      const res = await fetch(\`/api/admin/users/\${user._id}\`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: \`Bearer \${token}\`,
        },
        body: JSON.stringify({ isActive: !user.isActive }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update user');

      showNotification(\`User \${user.username} is now \${data.user.isActive ? 'Active' : 'Disabled'}\`);
      fetchUsers();
    } catch (err) {
      showNotification('', err.message);
    }
  };

  const handleDeleteUser = async (user) => {
    if (!confirm(\`Are you sure you want to permanently delete user "\${user.username}"?\`)) {
      return;
    }
    try {
      const token = getToken();
      const res = await fetch(\`/api/admin/users/\${user._id}\`, {
        method: 'DELETE',
        headers: { Authorization: \`Bearer \${token}\` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete user');

      showNotification(\`User \${user.username} deleted\`);
      fetchUsers();
    } catch (err) {
      showNotification('', err.message);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('dnc_admin_token');
    localStorage.removeItem('dnc_admin_user');
    router.push('/login');
  };

  // Metrics
  const nonAdminUsers = users.filter((u) => u.role !== 'admin');
  const totalUsersCount = nonAdminUsers.length;
  const activeUsersCount = nonAdminUsers.filter((u) => u.isActive && u.lookupsRemaining > 0).length;
  const exhaustedUsersCount = nonAdminUsers.filter((u) => u.lookupsRemaining <= 0).length;
  const totalLookupsAllocated = nonAdminUsers.reduce((sum, u) => sum + (u.lookupsTotal || 0), 0);
  const totalLookupsConsumed = nonAdminUsers.reduce((sum, u) => sum + (u.totalLookupsUsed || 0), 0);

  // Filtered users
  const filteredUsers = users.filter((u) => {
    const matchesSearch =
      u.username.toLowerCase().includes(search.toLowerCase()) ||
      (u.displayName && u.displayName.toLowerCase().includes(search.toLowerCase())) ||
      (u.planName && u.planName.toLowerCase().includes(search.toLowerCase()));

    if (!matchesSearch) return false;
    if (statusFilter === 'active') return u.isActive && (u.role === 'admin' || u.lookupsRemaining > 0);
    if (statusFilter === 'exhausted') return u.role !== 'admin' && u.lookupsRemaining <= 0;
    return true;
  });

  return (
    <div className="min-h-screen bg-white text-zinc-950 selection:bg-zinc-950 selection:text-white flex flex-col font-sans">
      {/* Top Navbar */}
      <header className="sticky top-0 z-40 bg-white border-b border-zinc-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-zinc-950 text-white flex items-center justify-center shadow-sm">
              <Shield className="w-5 h-5 stroke-[2]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-base tracking-tight text-zinc-950">Auto Lookup</span>
                <span className="bg-zinc-100 text-zinc-600 text-[11px] font-semibold px-2 py-0.5 rounded-full border border-zinc-200">
                  Portal
                </span>
              </div>
              <p className="text-[11px] text-zinc-400 hidden sm:block">Customer Licensing & Quota Control</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-2 bg-zinc-50 border border-zinc-200 px-3 py-1.5 rounded-lg text-xs">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-zinc-600 font-medium">Atlas Live</span>
              <span className="text-zinc-300">|</span>
              <span className="text-zinc-900 font-semibold">{adminUser?.username || 'MUadmin'}</span>
            </div>

            <button
              onClick={handleLogout}
              className="border border-zinc-200 hover:bg-zinc-50 text-zinc-700 hover:text-zinc-950 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
              title="Sign Out"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Alerts / Feedback */}
        {actionSuccess && (
          <div className="p-3.5 rounded-xl bg-zinc-950 text-white text-sm font-medium flex items-center justify-between shadow-sm">
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{actionSuccess}</span>
            </div>
            <button onClick={() => setActionSuccess('')} className="text-zinc-400 hover:text-white cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {actionError && (
          <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm font-medium flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{actionError}</span>
            </div>
            <button onClick={() => setActionError('')} className="text-red-500 hover:text-red-700 cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Overview Stats */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white border border-zinc-200 rounded-xl p-5 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Active Customers</span>
              <UserCheck className="w-4 h-4 text-zinc-400" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold tracking-tight text-zinc-950">{activeUsersCount}</span>
              <span className="text-xs text-zinc-500 font-medium">of {totalUsersCount} accounts</span>
            </div>
            <div className="mt-3 text-[11px] text-zinc-400 font-medium">
              {exhaustedUsersCount > 0 ? (
                <span className="text-amber-700 font-semibold">{exhaustedUsersCount} accounts out of credits</span>
              ) : (
                'All active accounts funded'
              )}
            </div>
          </div>

          <div className="bg-white border border-zinc-200 rounded-xl p-5 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Total Lookups Granted</span>
              <Zap className="w-4 h-4 text-zinc-400" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold tracking-tight text-zinc-950">{totalLookupsAllocated.toLocaleString()}</span>
              <span className="text-xs text-zinc-500 font-medium">credits</span>
            </div>
            <div className="mt-3 text-[11px] text-zinc-400 font-medium">Allocated lifetime quota pool</div>
          </div>

          <div className="bg-white border border-zinc-200 rounded-xl p-5 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Lookups Consumed</span>
              <TrendingUp className="w-4 h-4 text-zinc-400" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold tracking-tight text-zinc-950">{totalLookupsConsumed.toLocaleString()}</span>
              <span className="text-xs text-zinc-500 font-medium">performed</span>
            </div>
            <div className="mt-3 text-[11px] text-zinc-400 font-medium">Real-time compliance queries</div>
          </div>

          <div className="bg-white border border-zinc-200 rounded-xl p-5 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Exhaustion Policy</span>
              <Shield className="w-4 h-4 text-zinc-400" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-xs font-semibold text-zinc-900 bg-zinc-100 px-2 py-1 rounded border border-zinc-200">
                Auto-Logout
              </span>
            </div>
            <div className="mt-3 text-[11px] text-zinc-500 font-medium">
              Quotes: <em className="text-zinc-800">"limit reached contact admin for more limit"</em>
            </div>
          </div>
        </section>

        {/* Action / Search Bar */}
        <section className="bg-white border border-zinc-200 rounded-xl p-4 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex flex-1 w-full items-center gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search username, customer name, or plan..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-white border border-zinc-200 rounded-lg pl-9 pr-3 py-2 text-sm text-zinc-950 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-950 focus:border-zinc-950"
              />
            </div>

            {/* Segmented Filter */}
            <div className="hidden sm:inline-flex bg-zinc-100 p-1 rounded-lg border border-zinc-200 text-xs font-medium">
              <button
                type="button"
                onClick={() => setStatusFilter('all')}
                className={\`px-2.5 py-1 rounded-md transition-all cursor-pointer \${
                  statusFilter === 'all' ? 'bg-white text-zinc-950 shadow-xs font-semibold' : 'text-zinc-600 hover:text-zinc-950'
                }\`}
              >
                All ({users.length})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('active')}
                className={\`px-2.5 py-1 rounded-md transition-all cursor-pointer \${
                  statusFilter === 'active' ? 'bg-white text-zinc-950 shadow-xs font-semibold' : 'text-zinc-600 hover:text-zinc-950'
                }\`}
              >
                Active
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('exhausted')}
                className={\`px-2.5 py-1 rounded-md transition-all cursor-pointer \${
                  statusFilter === 'exhausted' ? 'bg-white text-zinc-950 shadow-xs font-semibold' : 'text-zinc-600 hover:text-zinc-950'
                }\`}
              >
                Limit Reached
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end">
            <button
              onClick={fetchUsers}
              disabled={loading}
              className="border border-zinc-200 hover:bg-zinc-50 text-zinc-700 font-medium px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              title="Refresh database"
            >
              <RefreshCw className={\`w-3.5 h-3.5 \${loading ? 'animate-spin' : ''}\`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>

            <button
              onClick={() => setIsCreateOpen(true)}
              className="bg-zinc-950 hover:bg-zinc-800 text-white font-medium px-4 py-2 rounded-lg text-sm transition-all flex items-center gap-2 cursor-pointer shadow-xs"
            >
              <Plus className="w-4 h-4 stroke-[2.5]" />
              <span>Create Customer</span>
            </button>
          </div>
        </section>

        {/* Users Table */}
        <section className="bg-white border border-zinc-200 rounded-xl overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-zinc-50 border-b border-zinc-200 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
                  <th className="py-3 px-4">Customer Account</th>
                  <th className="py-3 px-4">Role / Plan</th>
                  <th className="py-3 px-4">Lookup Balance</th>
                  <th className="py-3 px-4">Used</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 text-sm">
                {loading && users.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="py-12 text-center text-zinc-400">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <div className="w-6 h-6 border-2 border-zinc-200 border-t-zinc-950 rounded-full animate-spin" />
                        <span className="text-xs font-medium">Loading customer licenses...</span>
                      </div>
                    </td>
                  </tr>
                ) : filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="py-12 text-center text-zinc-400">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <Users className="w-8 h-8 text-zinc-300 stroke-[1.5]" />
                        <span className="text-sm font-medium text-zinc-700">No customer accounts found</span>
                        <p className="text-xs text-zinc-400">Create a customer or modify search filters</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((user) => {
                    const isAdmin = user.role === 'admin';
                    const isExhausted = !isAdmin && user.lookupsRemaining <= 0;
                    const percentLeft = user.lookupsTotal > 0 ? Math.round((user.lookupsRemaining / user.lookupsTotal) * 100) : 0;

                    return (
                      <tr key={user._id} className="hover:bg-zinc-50/70 transition-colors">
                        {/* Account Name */}
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-zinc-100 border border-zinc-200 flex items-center justify-center text-xs font-bold text-zinc-800 uppercase shrink-0">
                              {user.username.slice(0, 2)}
                            </div>
                            <div>
                              <div className="font-semibold text-zinc-950 flex items-center gap-2">
                                <span>{user.username}</span>
                                {isAdmin && (
                                  <span className="bg-zinc-950 text-white text-[10px] font-semibold px-1.5 py-0.2 rounded">
                                    ADMIN
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-zinc-500">
                                {user.displayName || (user.notes ? user.notes : 'No display name')}
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Plan */}
                        <td className="py-3.5 px-4">
                          <span className="bg-zinc-100 text-zinc-800 border border-zinc-200 text-xs font-medium px-2 py-0.5 rounded">
                            {user.planName || 'Standard'}
                          </span>
                        </td>

                        {/* Lookups Balance */}
                        <td className="py-3.5 px-4">
                          {isAdmin ? (
                            <span className="text-xs font-mono font-semibold text-zinc-600">Unlimited (∞)</span>
                          ) : (
                            <div className="space-y-1.5 min-w-[140px]">
                              <div className="flex items-center justify-between text-xs">
                                <span className={\`font-mono font-bold \${isExhausted ? 'text-red-600' : 'text-zinc-950'}\`}>
                                  {user.lookupsRemaining.toLocaleString()} / {user.lookupsTotal.toLocaleString()}
                                </span>
                                <span className="text-[11px] text-zinc-400 font-medium">
                                  {isExhausted ? '0%' : \`\${percentLeft}%\`}
                                </span>
                              </div>
                              <div className="w-full bg-zinc-100 h-1.5 rounded-full overflow-hidden border border-zinc-200/60">
                                <div
                                  className={\`h-full rounded-full transition-all duration-300 \${
                                    isExhausted ? 'bg-red-500' : percentLeft <= 20 ? 'bg-amber-500' : 'bg-zinc-950'
                                  }\`}
                                  style={{ width: \`\${Math.max(0, Math.min(100, percentLeft))}%\` }}
                                />
                              </div>
                            </div>
                          )}
                        </td>

                        {/* Used */}
                        <td className="py-3.5 px-4">
                          <span className="text-xs font-mono font-medium text-zinc-700">
                            {(user.totalLookupsUsed || 0).toLocaleString()}
                          </span>
                        </td>

                        {/* Status */}
                        <td className="py-3.5 px-4">
                          {!user.isActive ? (
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-zinc-100 text-zinc-500 border border-zinc-200">
                              <span className="w-1.5 h-1.5 rounded-full bg-zinc-400" />
                              Disabled
                            </span>
                          ) : isExhausted ? (
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-50 text-red-700 border border-red-200">
                              <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                              Limit Reached
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-800 border border-emerald-200">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                              Active
                            </span>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="py-3.5 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {!isAdmin && (
                              <button
                                onClick={() => {
                                  setSelectedUser(user);
                                  setAddCreditsAmount(500);
                                  setIsCreditOpen(true);
                                }}
                                className="bg-white hover:bg-zinc-100 text-zinc-900 border border-zinc-200 text-xs font-medium px-2.5 py-1 rounded-md transition-colors flex items-center gap-1 cursor-pointer"
                                title="Add Credits"
                              >
                                <PlusCircle className="w-3.5 h-3.5 text-zinc-600" />
                                <span>+ Credits</span>
                              </button>
                            )}

                            <button
                              onClick={() => {
                                setSelectedUser(user);
                                setNewPassword('');
                                setIsPasswordOpen(true);
                              }}
                              className="p-1.5 text-zinc-500 hover:text-zinc-950 hover:bg-zinc-100 rounded-md transition-colors cursor-pointer border border-transparent hover:border-zinc-200"
                              title="Reset Password"
                            >
                              <KeyRound className="w-4 h-4" />
                            </button>

                            {!isAdmin && (
                              <>
                                <button
                                  onClick={() => handleToggleStatus(user)}
                                  className={\`p-1.5 rounded-md transition-colors cursor-pointer border border-transparent hover:border-zinc-200 \${
                                    user.isActive
                                      ? 'text-zinc-500 hover:text-amber-700 hover:bg-amber-50'
                                      : 'text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50'
                                  }\`}
                                  title={user.isActive ? 'Disable User' : 'Enable User'}
                                >
                                  {user.isActive ? <XCircle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                                </button>

                                <button
                                  onClick={() => handleDeleteUser(user)}
                                  className="p-1.5 text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors cursor-pointer border border-transparent hover:border-red-200"
                                  title="Delete User"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </>
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
        </section>
      </main>

      {/* Modal: Create Customer */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-zinc-200 rounded-2xl max-w-md w-full p-6 shadow-xl relative animate-in fade-in zoom-in-95 duration-150">
            <button
              onClick={() => setIsCreateOpen(false)}
              className="absolute right-4 top-4 text-zinc-400 hover:text-zinc-700 p-1 rounded-md"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2.5 mb-1">
              <div className="w-7 h-7 rounded-md bg-zinc-950 text-white flex items-center justify-center">
                <Plus className="w-4 h-4 stroke-[2.5]" />
              </div>
              <h3 className="text-base font-bold text-zinc-950">Create New Customer</h3>
            </div>
            <p className="text-xs text-zinc-500 mb-5">
              Set credentials and lookup balance for extension login
            </p>

            <form onSubmit={handleCreateUser} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-700 uppercase tracking-wider mb-1">
                  Username *
                </label>
                <input
                  type="text"
                  required
                  value={newUserData.username}
                  onChange={(e) => setNewUserData({ ...newUserData, username: e.target.value })}
                  placeholder="e.g. john_doe"
                  className="w-full bg-white border border-zinc-200 rounded-lg px-3 py-2 text-sm text-zinc-950 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-950"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-700 uppercase tracking-wider mb-1">
                  Initial Password *
                </label>
                <input
                  type="password"
                  required
                  value={newUserData.password}
                  onChange={(e) => setNewUserData({ ...newUserData, password: e.target.value })}
                  placeholder="Customer password"
                  className="w-full bg-white border border-zinc-200 rounded-lg px-3 py-2 text-sm text-zinc-950 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-950"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-700 uppercase tracking-wider mb-1">
                  Customer / Business Name
                </label>
                <input
                  type="text"
                  value={newUserData.displayName}
                  onChange={(e) => setNewUserData({ ...newUserData, displayName: e.target.value })}
                  placeholder="e.g. Acme Solar Leads LLC"
                  className="w-full bg-white border border-zinc-200 rounded-lg px-3 py-2 text-sm text-zinc-950 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-950"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-zinc-700 uppercase tracking-wider">
                    Lookup Limit *
                  </label>
                  <span className="text-xs font-mono font-bold text-zinc-950">{newUserData.lookupLimit} lookups</span>
                </div>
                <input
                  type="number"
                  min="1"
                  required
                  value={newUserData.lookupLimit}
                  onChange={(e) => setNewUserData({ ...newUserData, lookupLimit: Number(e.target.value) })}
                  className="w-full bg-white border border-zinc-200 rounded-lg px-3 py-2 text-sm text-zinc-950 focus:outline-none focus:ring-2 focus:ring-zinc-950"
                />
                {/* Preset Chips */}
                <div className="flex items-center gap-1.5 mt-2">
                  {[250, 500, 1000, 2500, 5000].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setNewUserData({ ...newUserData, lookupLimit: preset })}
                      className={\`text-[11px] px-2 py-0.5 rounded border transition-colors cursor-pointer \${
                        newUserData.lookupLimit === preset
                          ? 'bg-zinc-950 text-white border-zinc-950 font-semibold'
                          : 'bg-zinc-50 text-zinc-600 border-zinc-200 hover:bg-zinc-100'
                      }\`}
                    >
                      {preset.toLocaleString()}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-700 uppercase tracking-wider mb-1">
                  Plan Name
                </label>
                <input
                  type="text"
                  value={newUserData.planName}
                  onChange={(e) => setNewUserData({ ...newUserData, planName: e.target.value })}
                  placeholder="Starter / Growth / Pro"
                  className="w-full bg-white border border-zinc-200 rounded-lg px-3 py-2 text-sm text-zinc-950 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-950"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="border border-zinc-200 hover:bg-zinc-50 text-zinc-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-zinc-950 hover:bg-zinc-800 text-white px-5 py-2 rounded-lg text-sm font-semibold transition-all cursor-pointer shadow-xs"
                >
                  Create Customer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Add Credits */}
      {isCreditOpen && selectedUser && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-zinc-200 rounded-2xl max-w-sm w-full p-6 shadow-xl relative animate-in fade-in zoom-in-95 duration-150">
            <button
              onClick={() => setIsCreditOpen(false)}
              className="absolute right-4 top-4 text-zinc-400 hover:text-zinc-700 p-1 rounded-md"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 mb-1">
              <div className="w-7 h-7 rounded-md bg-zinc-950 text-white flex items-center justify-center">
                <PlusCircle className="w-4 h-4 stroke-[2]" />
              </div>
              <h3 className="text-base font-bold text-zinc-950">Add Credits</h3>
            </div>
            <p className="text-xs text-zinc-500 mb-4">
              Top up lookup credits for <strong className="text-zinc-950 font-semibold">{selectedUser.username}</strong>
            </p>

            {/* Current Balance Card */}
            <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-3.5 mb-4 flex items-center justify-between text-xs">
              <div>
                <span className="text-zinc-500 block">Current Balance</span>
                <span className="text-sm font-mono font-bold text-zinc-950">{selectedUser.lookupsRemaining.toLocaleString()} left</span>
              </div>
              <div className="text-right">
                <span className="text-zinc-500 block">After Top-up</span>
                <span className="text-sm font-mono font-bold text-emerald-600">
                  {(selectedUser.lookupsRemaining + Number(addCreditsAmount || 0)).toLocaleString()} left
                </span>
              </div>
            </div>

            <form onSubmit={handleAddCredits} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-700 uppercase tracking-wider mb-1">
                  Credits to Add
                </label>
                <input
                  type="number"
                  min="1"
                  required
                  value={addCreditsAmount}
                  onChange={(e) => setAddCreditsAmount(Number(e.target.value))}
                  className="w-full bg-white border border-zinc-200 rounded-lg px-3 py-2 text-sm font-mono text-zinc-950 focus:outline-none focus:ring-2 focus:ring-zinc-950"
                />

                {/* Quick Add Chips */}
                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  {[100, 250, 500, 1000, 2500].map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => setAddCreditsAmount(amt)}
                      className={\`text-[11px] px-2.5 py-1 rounded border transition-colors cursor-pointer \${
                        addCreditsAmount === amt
                          ? 'bg-zinc-950 text-white border-zinc-950 font-semibold'
                          : 'bg-zinc-50 text-zinc-700 border-zinc-200 hover:bg-zinc-100'
                      }\`}
                    >
                      +{amt}
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsCreditOpen(false)}
                  className="border border-zinc-200 hover:bg-zinc-50 text-zinc-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-zinc-950 hover:bg-zinc-800 text-white px-5 py-2 rounded-lg text-sm font-semibold transition-all cursor-pointer shadow-xs"
                >
                  Apply Credits
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Reset Password */}
      {isPasswordOpen && selectedUser && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-zinc-200 rounded-2xl max-w-sm w-full p-6 shadow-xl relative animate-in fade-in zoom-in-95 duration-150">
            <button
              onClick={() => setIsPasswordOpen(false)}
              className="absolute right-4 top-4 text-zinc-400 hover:text-zinc-700 p-1 rounded-md"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 mb-1">
              <div className="w-7 h-7 rounded-md bg-zinc-950 text-white flex items-center justify-center">
                <KeyRound className="w-4 h-4 stroke-[2]" />
              </div>
              <h3 className="text-base font-bold text-zinc-950">Reset Password</h3>
            </div>
            <p className="text-xs text-zinc-500 mb-4">
              Set new password for <strong className="text-zinc-950 font-semibold">{selectedUser.username}</strong>
            </p>

            <form onSubmit={handleResetPassword} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-700 uppercase tracking-wider mb-1">
                  New Password *
                </label>
                <input
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter new password"
                  className="w-full bg-white border border-zinc-200 rounded-lg px-3 py-2 text-sm text-zinc-950 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-950"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsPasswordOpen(false)}
                  className="border border-zinc-200 hover:bg-zinc-50 text-zinc-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-zinc-950 hover:bg-zinc-800 text-white px-5 py-2 rounded-lg text-sm font-semibold transition-all cursor-pointer shadow-xs"
                >
                  Save Password
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
`;
fs.writeFileSync(path.join(portalDir, 'src', 'app', 'page.js'), dashboardPage.trim() + '\n', 'utf8');
console.log('Updated page.js');
console.log('Portal redesign completed successfully!');
