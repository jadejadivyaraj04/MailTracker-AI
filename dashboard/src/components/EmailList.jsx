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

const formatTimeAgo = value => {
  if (!value) return '';
  try {
    const now = new Date();
    const then = new Date(value);
    const diffMs = now - then;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return formatDateTime(value);
  } catch (error) {
    return '';
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
        const toRecipients = message.recipients?.to || [];
        const ccRecipients = message.recipients?.cc || [];
        const bccRecipients = message.recipients?.bcc || [];

        return (
          <article key={message.uid} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-brand-300 hover:shadow-md">
            {/* Header */}
            <div className="mb-4 flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-semibold text-slate-900 mb-1 truncate">
                  {message.subject || 'Untitled email'}
                </h3>
                <p className="text-sm text-slate-500">
                  Sent {formatDateTime(message.sentAt)}
                </p>
              </div>
              
              {/* Stats badges */}
              <div className="flex gap-3 shrink-0">
                <div className="text-center">
                  <div className="text-xl font-bold text-brand-600">{message.openCount}</div>
                  <div className="text-xs text-slate-500">Opens</div>
                </div>
                <div className="text-center">
                  <div className="text-xl font-bold text-emerald-600">{message.clickCount}</div>
                  <div className="text-xs text-slate-500">Clicks</div>
                </div>
              </div>
            </div>

            {/* Sent To Section */}
            <div className="mb-4 pb-4 border-b border-slate-100">
              <div className="flex items-start gap-2 mb-2">
                <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide shrink-0">Sent To:</span>
                <div className="flex-1 flex flex-wrap gap-2">
                  {toRecipients.length > 0 ? (
                    toRecipients.map((email, idx) => (
                      <span key={idx} className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
                        {email}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-slate-400 italic">No recipients found</span>
                  )}
                </div>
              </div>
              
              {ccRecipients.length > 0 && (
                <div className="flex items-start gap-2 mb-2">
                  <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide shrink-0">CC:</span>
                  <div className="flex-1 flex flex-wrap gap-2">
                    {ccRecipients.map((email, idx) => (
                      <span key={idx} className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-slate-50 text-slate-600 border border-slate-200">
                        {email}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {bccRecipients.length > 0 && (
                <div className="flex items-start gap-2">
                  <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide shrink-0">BCC:</span>
                  <div className="flex-1 flex flex-wrap gap-2">
                    {bccRecipients.map((email, idx) => (
                      <span key={idx} className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-slate-50 text-slate-600 border border-slate-200">
                        {email}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Read By Section */}
            {isSingleRecipient && recipientStatus.length > 0 ? (
              <div>
                <div className="flex items-start gap-2 mb-3">
                  <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide shrink-0">Read By:</span>
                  <div className="flex-1">
                    {recipientStatus.map((status, idx) => (
                      <div
                        key={idx}
                        className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium mb-2 ${
                          status.read
                            ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                            : 'bg-slate-50 text-slate-600 border border-slate-200'
                        }`}
                      >
                        <span className={`w-2 h-2 rounded-full ${status.read ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                        <span className="font-semibold">{status.email}</span>
                        <span className={`text-xs ${status.read ? 'text-emerald-700' : 'text-slate-500'}`}>
                          {status.read ? (
                            <>
                              <span className="font-bold">✓ Read</span>
                              {status.readAt && (
                                <span className="ml-1 opacity-75">
                                  {formatTimeAgo(status.readAt)}
                                </span>
                              )}
                            </>
                          ) : (
                            <span>○ Not read</span>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : allRecipients.length > 0 ? (
              <div>
                <div className="flex items-start gap-2">
                  <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide shrink-0">Read Status:</span>
                  <div className="flex-1">
                    {message.openCount > 0 ? (
                      <div className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-amber-50 text-amber-800 border border-amber-200">
                        <span className="w-2 h-2 rounded-full bg-amber-500" />
                        <span className="font-medium">At least one recipient opened</span>
                        {message.lastOpenedAt && (
                          <span className="text-xs opacity-75 ml-1">
                            ({formatTimeAgo(message.lastOpenedAt)})
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-slate-50 text-slate-600 border border-slate-200">
                        <span className="w-2 h-2 rounded-full bg-slate-400" />
                        <span className="font-medium">Not opened yet</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

export default EmailList;
