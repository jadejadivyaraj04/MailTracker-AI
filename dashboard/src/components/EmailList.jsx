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
      {messages.map(message => {
        const allRecipients = [
          ...(message.recipients?.to || []),
          ...(message.recipients?.cc || []),
          ...(message.recipients?.bcc || [])
        ].filter(Boolean);

        const recipientStatus = message.recipientStatus || [];
        const isSingleRecipient = allRecipients.length === 1;

        return (
          <article key={message.uid} className="flex flex-col gap-4 rounded-xl border border-slate-200 p-4 transition hover:border-brand-200 hover:shadow-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex-1">
                <h3 className="text-base font-medium text-slate-800">{message.subject || 'Untitled email'}</h3>
                <p className="text-sm text-slate-500">Sent {formatDateTime(message.sentAt)}</p>
                <p className="text-xs text-slate-400 mt-1">
                  To: {allRecipients.length ? allRecipients.join(', ') : '—'}
                  {message.recipients?.cc?.length ? ` | CC: ${message.recipients.cc.join(', ')}` : ''}
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
            </div>

            {/* Recipient Read Status */}
            {isSingleRecipient && recipientStatus.length > 0 && (
              <div className="mt-2 pt-3 border-t border-slate-100">
                <p className="text-xs font-medium text-slate-600 mb-2">Recipient Status:</p>
                <div className="flex flex-wrap gap-2">
                  {recipientStatus.map((status, idx) => (
                    <div
                      key={idx}
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                        status.read
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-slate-50 text-slate-600 border border-slate-200'
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${status.read ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                      <span className="truncate max-w-[200px]">{status.email}</span>
                      <span className="font-semibold">{status.read ? '✓ Read' : '○ Not read'}</span>
                      {status.read && status.readAt && (
                        <span className="text-[10px] opacity-75">
                          {formatDateTime(status.readAt)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Multiple recipients - show summary */}
            {!isSingleRecipient && allRecipients.length > 0 && (
              <div className="mt-2 pt-3 border-t border-slate-100">
                <p className="text-xs font-medium text-slate-600 mb-2">
                  Recipients ({allRecipients.length}): {message.openCount > 0 ? 'At least one opened' : 'Not opened yet'}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {allRecipients.map((email, idx) => (
                    <span
                      key={idx}
                      className="inline-block rounded px-2 py-0.5 text-xs bg-slate-100 text-slate-600 border border-slate-200"
                    >
                      {email}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

export default EmailList;
