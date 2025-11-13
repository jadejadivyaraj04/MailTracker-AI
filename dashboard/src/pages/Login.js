import { useState } from 'react';

function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = event => {
    event.preventDefault();
    if (!email.trim()) {
      setError('Enter a valid email or identifier.');
      return;
    }

    setError('');
    const userId = email.trim().toLowerCase();
    onLogin?.(userId);
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-lg">
        <h1 className="text-2xl font-semibold text-brand-600">MailTracker AI</h1>
        <p className="mt-2 text-sm text-slate-500">
          Sign in with any identifier (we recommend using your Gmail address). This is a demo login and does not require a password.
        </p>
        <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
          <label className="block text-sm font-medium text-slate-700" htmlFor="email">
            Email or User ID
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={event => setEmail(event.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
            required
          />
          {error ? <p className="text-sm text-red-500">{error}</p> : null}
          <button
            type="submit"
            className="w-full rounded-lg bg-brand-500 px-4 py-2 text-white transition hover:bg-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-200"
          >
            Continue
          </button>
        </form>
      </div>
      <p className="mt-6 text-xs text-slate-500">
        Tracking data syncs via your chosen identifier. Use the same ID inside the Chrome extension to correlate stats.
      </p>
    </div>
  );
}

export default Login;
