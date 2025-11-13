function Navbar({ userId, onLogout }) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4">
        <div>
          <h1 className="text-xl font-semibold text-brand-600">MailTracker AI</h1>
          <p className="text-xs text-slate-500">Signed in as {userId}</p>
        </div>
        <button
          onClick={onLogout}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 transition hover:border-brand-400 hover:text-brand-600"
        >
          Log out
        </button>
      </div>
    </header>
  );
}

export default Navbar;
