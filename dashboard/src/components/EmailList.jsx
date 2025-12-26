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
        const toRecipients = message.recipients?.to || [];
        const recipientStatus = message.recipientStatus || [];

        // Create a map of email to read status for quick lookup
        const statusMap = new Map();
        recipientStatus.forEach(status => {
          statusMap.set(status.email.toLowerCase().trim(), status);
        });

        return (
          <article key={message.uid} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-brand-300 hover:shadow-md">
            {/* Header */}
            <div className="mb-4 flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-semibold text-slate-900 mb-1 truncate">
                  {message.subject || 'Untitled email'}
                </h3>
                <p className="text-sm text-slate-500 flex items-center gap-2">
                  Sent {formatDateTime(message.sentAt)}
                  <a
                    href={`https://mailtracker-ai.onrender.com/debug/track/${message.uid}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-brand-400 hover:text-brand-600 underline"
                  >
                    (Debug Data)
                  </a>
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

            {/* Sent To and Read Status */}
            {toRecipients.length > 0 ? (
              <div className="space-y-2">
                {toRecipients.map((email, idx) => {
                  const normalizedEmail = email.toLowerCase().trim();
                  const status = statusMap.get(normalizedEmail);

                  // STRICT CHECK: Only show as read if:
                  // 1. Status object exists
                  // 2. read property exists and is explicitly true (boolean)
                  // Default to false if status is missing or read is not explicitly true
                  let isRead = false;

                  if (status &&
                    typeof status === 'object' &&
                    status.hasOwnProperty('read') &&
                    status.read === true &&
                    typeof status.read === 'boolean') {
                    isRead = true;
                  }

                  return (
                    <div
                      key={idx}
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg ${isRead
                          ? 'bg-emerald-50 border border-emerald-200'
                          : 'bg-slate-50 border border-slate-200'
                        }`}
                    >
                      <span className={`w-2 h-2 rounded-full shrink-0 ${isRead ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                      <span className="font-medium text-slate-900 flex-1">{email}</span>
                      <span className={`text-sm font-semibold ${isRead ? 'text-emerald-700' : 'text-slate-500'}`}>
                        {isRead ? '✓ Read' : '○ Not read'}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-sm text-slate-400 italic">No recipients found</div>
            )}
          </article>
        );
      })}
    </div>
  );
}

export default EmailList;
