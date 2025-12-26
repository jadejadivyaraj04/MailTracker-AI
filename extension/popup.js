// MailTracker AI Popup Script
// Handles toggle switch and user ID synchronization with background storage

document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('trackingToggle');
  const userInput = document.getElementById('userIdInput');

  const loadActivity = async (userId) => {
    const activityFeed = document.getElementById('activityFeed');
    if (!userId || userId === 'default') {
      activityFeed.innerHTML = '<p class="hint">Sign in to Gmail to see activity.</p>';
      return;
    }

    try {
      const response = await fetch(`https://mailtracker-ai.onrender.com/stats/user/${encodeURIComponent(userId)}`);
      if (!response.ok) throw new Error('Failed to fetch');
      const data = await response.json();

      const messages = data.messages || [];
      if (messages.length === 0) {
        activityFeed.innerHTML = '<p class="hint">No emails tracked yet.</p>';
        return;
      }

      activityFeed.innerHTML = messages.slice(0, 4).map(msg => `
        <div class="activity-item">
          <div class="activity-info">
            <span class="activity-subject">${msg.subject || 'No Subject'}</span>
            <span class="activity-date">${new Date(msg.sentAt).toLocaleDateString()}</span>
          </div>
          <span class="activity-badge ${msg.openCount > 0 ? 'badge-read' : 'badge-unread'}">
            ${msg.openCount > 0 ? 'READ' : 'SENT'}
          </span>
        </div>
      `).join('');
    } catch (err) {
      activityFeed.innerHTML = '<p class="hint">Dashboard unavailable.</p>';
    }
  };

  const refreshState = () => {
    chrome.runtime.sendMessage({ type: 'mailtracker:get-status' }, response => {
      if (!response) return;
      toggle.checked = Boolean(response.trackingEnabled);
    });

    chrome.runtime.sendMessage({ type: 'mailtracker:get-user' }, response => {
      if (!response) return;
      const uid = response.userId === 'default' ? '' : response.userId;
      userInput.value = uid;
      loadActivity(response.userId);
    });
  };

  toggle.addEventListener('change', () => {
    chrome.runtime.sendMessage({
      type: 'mailtracker:set-status',
      payload: { trackingEnabled: toggle.checked }
    });
  });

  const persistUserId = () => {
    const value = userInput.value.trim() || 'default';
    chrome.runtime.sendMessage({
      type: 'mailtracker:set-user',
      payload: { userId: value }
    });
  };

  userInput.addEventListener('blur', persistUserId);
  userInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      persistUserId();
      userInput.blur();
    }
  });

  refreshState();
});
