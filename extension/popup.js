// MailTracker AI Popup Script
// Handles toggle switch and user ID synchronization with background storage

document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('trackingToggle');
  const userInput = document.getElementById('userIdInput');

  const refreshState = () => {
    chrome.runtime.sendMessage({ type: 'mailtracker:get-status' }, response => {
      if (!response) return;
      toggle.checked = Boolean(response.trackingEnabled);
    });

    chrome.runtime.sendMessage({ type: 'mailtracker:get-user' }, response => {
      if (!response) return;
      userInput.value = response.userId === 'default' ? '' : response.userId;
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
