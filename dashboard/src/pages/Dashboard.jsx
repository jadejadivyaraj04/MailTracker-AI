import { useEffect, useMemo, useState } from 'react';
import Navbar from '../components/Navbar.jsx';
import EmailList from '../components/EmailList.jsx';
import StatsChart from '../components/StatsChart.jsx';
import { exportToCSV } from '../utils/csvExport.js';

function Dashboard({ userId, apiBase, onLogout }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [stats, setStats] = useState(null);

  useEffect(() => {
    const fetchStats = async () => {
      if (!apiBase) {
        setError('API base URL not configured.');
        return;
      }

      try {
        setLoading(true);
        setError('');
        console.log('[Dashboard] Fetching stats from:', `${apiBase}/stats/user/${encodeURIComponent(userId)}`);
        const response = await fetch(`${apiBase}/stats/user/${encodeURIComponent(userId)}`);

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          console.error('[Dashboard] API error:', response.status, errorData);
          throw new Error(errorData.error || `Failed to fetch stats: ${response.status}`);
        }

        const payload = await response.json();
        console.log('[Dashboard] Received stats:', payload);
        setStats(payload);
      } catch (err) {
        console.error('[Dashboard] Failed to load dashboard data:', err);
        setError(`Unable to load analytics: ${err.message}. Please verify the backend URL is correct.`);
      } finally {
        setLoading(false);
      }
    };

    if (userId) {
      fetchStats();
    }
  }, [apiBase, userId]);

  const chartData = useMemo(() => {
    if (!stats?.messages) return [];
    const groups = new Map();

    stats.messages.forEach(message => {
      const key = new Date(message.sentAt).toISOString().slice(0, 10);
      const existing = groups.get(key) || { date: key, opens: 0, clicks: 0 };
      existing.opens += message.openCount;
      existing.clicks += message.clickCount;
      groups.set(key, existing);
    });

    return Array.from(groups.values()).sort((a, b) => (a.date > b.date ? 1 : -1));
  }, [stats]);

  return (
    <div className="flex min-h-screen flex-col bg-[#f8fafc]">
      <Navbar userId={userId} onLogout={onLogout} />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">
        <header className="mb-10 flex items-end justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">Email Performance</h1>
            <p className="mt-2 text-slate-500">Track and analyze your outreach engagement in real-time.</p>
          </div>

          {stats?.messages?.length > 0 && (
            <button
              onClick={() => exportToCSV(stats.messages)}
              className="flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm border border-slate-200 transition hover:bg-slate-50 hover:shadow-md active:scale-95"
            >
              <span className="text-lg">📊</span>
              Download CSV
            </button>
          )}
        </header>

        {loading ? (
          <div className="flex h-96 items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-white/50 backdrop-blur-sm">
            <div className="text-center">
              <div className="mb-4 flex justify-center">
                <div className="h-10 w-10 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent"></div>
              </div>
              <p className="text-slate-500 font-medium">Crunching your data...</p>
            </div>
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-red-100 bg-red-50/50 p-6 text-red-600 backdrop-blur-sm">
            <div className="flex items-center gap-3">
              <span className="text-xl">⚠️</span>
              <p className="font-medium">{error}</p>
            </div>
          </div>
        ) : stats ? (
          <div className="space-y-10">
            {/* Stats Grid */}
            <section className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              <article className="group relative overflow-hidden rounded-2xl bg-white p-6 shadow-[0_2px_15px_-3px_rgba(0,0,0,0.07),0_10px_20px_-2px_rgba(0,0,0,0.04)] transition-all hover:shadow-xl">
                <div className="relative z-10">
                  <p className="text-sm font-semibold uppercase tracking-wider text-slate-400">Tracked Emails</p>
                  <p className="mt-3 text-4xl font-bold text-slate-900">{stats.totalMessages}</p>
                </div>
                <div className="absolute -bottom-2 -right-2 text-6xl opacity-[0.03] grayscale transition-all group-hover:scale-110 group-hover:opacity-[0.07]">📩</div>
              </article>

              <article className="group relative overflow-hidden rounded-2xl bg-white p-6 shadow-[0_2px_15px_-3px_rgba(0,0,0,0.07),0_10px_20px_-2px_rgba(0,0,0,0.04)] transition-all hover:shadow-xl">
                <div className="relative z-10">
                  <p className="text-sm font-semibold uppercase tracking-wider text-slate-400">Total Opens</p>
                  <p className="mt-3 text-4xl font-bold text-indigo-600">{stats.totalOpens}</p>
                </div>
                <div className="absolute -bottom-2 -right-2 text-6xl opacity-[0.03] grayscale transition-all group-hover:scale-110 group-hover:opacity-[0.07]">👁️</div>
              </article>

              <article className="group relative overflow-hidden rounded-2xl bg-white p-6 shadow-[0_2px_15px_-3px_rgba(0,0,0,0.07),0_10px_20px_-2px_rgba(0,0,0,0.04)] transition-all hover:shadow-xl">
                <div className="relative z-10">
                  <p className="text-sm font-semibold uppercase tracking-wider text-slate-400">Total Clicks</p>
                  <p className="mt-3 text-4xl font-bold text-emerald-600">{stats.totalClicks}</p>
                </div>
                <div className="absolute -bottom-2 -right-2 text-6xl opacity-[0.03] grayscale transition-all group-hover:scale-110 group-hover:opacity-[0.07]">🖱️</div>
              </article>

              <article className="group relative overflow-hidden rounded-2xl bg-white p-6 shadow-[0_2px_15px_-3px_rgba(0,0,0,0.07),0_10px_20px_-2px_rgba(0,0,0,0.04)] transition-all hover:shadow-xl">
                <div className="relative z-10">
                  <p className="text-sm font-semibold uppercase tracking-wider text-slate-400">Engage Rate</p>
                  <p className="mt-3 text-4xl font-bold text-slate-900">
                    {stats.totalMessages ? Math.round((stats.totalOpens / stats.totalMessages) * 100) : 0}%
                  </p>
                </div>
                <div className="absolute -bottom-2 -right-2 text-6xl opacity-[0.03] grayscale transition-all group-hover:scale-110 group-hover:opacity-[0.07]">📈</div>
              </article>
            </section>

            {/* Chart Section */}
            <section className="rounded-3xl bg-white p-8 shadow-[0_2px_15px_-3px_rgba(0,0,0,0.07),0_10px_20px_-2px_rgba(0,0,0,0.04)]">
              <div className="mb-8 flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">Engagement Over Time</h2>
                  <p className="text-sm text-slate-500">Interactive trend of opens and clicks.</p>
                </div>
                <div className="flex gap-4">
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-3 rounded-full bg-indigo-500"></div>
                    <span className="text-xs font-medium text-slate-600 uppercase tracking-tighter">Opens</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-3 rounded-full bg-emerald-500"></div>
                    <span className="text-xs font-medium text-slate-600 uppercase tracking-tighter">Clicks</span>
                  </div>
                </div>
              </div>
              <div className="h-80 w-full">
                <StatsChart data={chartData} />
              </div>
            </section>

            {/* Recent Table Section */}
            <section className="rounded-3xl bg-white p-8 shadow-[0_2px_15px_-3px_rgba(0,0,0,0.07),0_10px_20px_-2px_rgba(0,0,0,0.04)]">
              <div className="mb-8">
                <h2 className="text-xl font-bold text-slate-900">Recent Activity</h2>
                <p className="text-sm text-slate-500">Detailed breakdown of your most recent tracked emails.</p>
              </div>
              <EmailList messages={stats.messages} />
            </section>
          </div>
        ) : null}
      </main>
    </div>
  );
}

export default Dashboard;
