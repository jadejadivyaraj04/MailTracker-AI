import { useEffect, useMemo, useState } from 'react';
import Navbar from '../components/Navbar.js';
import EmailList from '../components/EmailList.js';
import StatsChart from '../components/StatsChart.js';

function Dashboard({ userId, apiBase, onLogout }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [stats, setStats] = useState(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        setLoading(true);
        setError('');
        const response = await fetch(`${apiBase}/stats/user/${encodeURIComponent(userId)}`);
        if (!response.ok) {
          throw new Error('Failed to fetch stats');
        }
        const payload = await response.json();
        setStats(payload);
      } catch (err) {
        console.error('Failed to load dashboard data', err);
        setError('Unable to load analytics. Please verify the backend URL.');
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
    <div className="flex min-h-screen flex-col">
      <Navbar userId={userId} onLogout={onLogout} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        {loading ? (
          <div className="flex h-64 items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white">
            <p className="text-slate-500">Loading your analytics…</p>
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-600">
            {error}
          </div>
        ) : stats ? (
          <div className="space-y-6">
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <article className="rounded-2xl bg-white p-4 shadow-sm">
                <p className="text-sm text-slate-500">Tracked Emails</p>
                <p className="mt-2 text-2xl font-semibold">{stats.totalMessages}</p>
              </article>
              <article className="rounded-2xl bg-white p-4 shadow-sm">
                <p className="text-sm text-slate-500">Total Opens</p>
                <p className="mt-2 text-2xl font-semibold text-brand-600">{stats.totalOpens}</p>
              </article>
              <article className="rounded-2xl bg-white p-4 shadow-sm">
                <p className="text-sm text-slate-500">Total Clicks</p>
                <p className="mt-2 text-2xl font-semibold text-emerald-600">{stats.totalClicks}</p>
              </article>
              <article className="rounded-2xl bg-white p-4 shadow-sm">
                <p className="text-sm text-slate-500">Open Rate</p>
                <p className="mt-2 text-2xl font-semibold">
                  {stats.totalMessages ? Math.round((stats.totalOpens / stats.totalMessages) * 100) : 0}%
                </p>
              </article>
            </section>

            <section className="rounded-2xl bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-800">Engagement Over Time</h2>
              <p className="text-sm text-slate-500">Sum of opens and clicks grouped by send date.</p>
              <div className="mt-4 h-72">
                <StatsChart data={chartData} />
              </div>
            </section>

            <section className="rounded-2xl bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-800">Recent Emails</h2>
              <EmailList messages={stats.messages} />
            </section>
          </div>
        ) : null}
      </main>
    </div>
  );
}

export default Dashboard;
