const formatDateTime = value => {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(value));
  } catch (error) {
    return value;
  }
};

function EmailList({ messages = [] }) {
  if (!messages.length) {
    return <p className="text-sm text-slate-500">No tracked emails yet. Send a message with the Chrome extension installed.</p>;
  }

  return (
    <div className="space-y-4">
      {messages.map(message => (
        <article key={message.uid} className="flex flex-col gap-4 rounded-xl border border-slate-200 p-4 transition hover:border-brand-200 hover:shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-base font-medium text-slate-800">{message.subject || 'Untitled email'}</h3>
            <p className="text-sm text-slate-500">Sent {formatDateTime(message.sentAt)}</p>
            <p className="text-xs text-slate-400">
              To: {(message.recipients?.to || []).join(', ') || '—'}
            </p>
          </div>
          <div className="flex gap-6 text-sm sm:text-right">
            <div>
              <p className="font-semibold text-brand-600">{message.openCount}</p>
              <p className="text-xs text-slate-500">Opens</p>
            </div>
            <div>
              <p className="font-semibold text-emerald-600">{message.clickCount}</p>
              <p className="text-xs text-slate-500">Clicks</p>
            </div>
            <div>
              <p className="font-semibold text-slate-700">{formatDateTime(message.lastOpenedAt)}</p>
              <p className="text-xs text-slate-500">Last open</p>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

export default EmailList;
