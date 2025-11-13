# MailTracker AI Chrome Extension

A Gmail-focused Chrome extension that injects an invisible tracking pixel, rewrites outgoing links for click analytics, and notifies a companion backend when emails are sent.

## Features

- Detects Gmail send events without needing the Gmail API.
- Appends a 1×1 pixel served by the MailTracker AI backend.
- Rewrites hyperlinks with redirect URLs to track clicks.
- Persists a per-user tracking toggle and user identifier via the popup UI.
- Shows Chrome notifications when tracking is active.

## Project Structure

```
extension/
├── manifest.json
├── background.js
├── content_script.js
├── popup.html
├── popup.js
├── popup.css
├── icons/
│   ├── 16.png
│   ├── 48.png
│   └── 128.png
└── README.md
```

## Local Development

1. Build the backend first so the `MAILTRACKER_BACKEND_BASE` URLs resolve (or adjust the constant in `content_script.js`).
2. Ensure the backend exposes the `/register`, `/pixel`, and `/redirect` endpoints specified in the main project README.
3. Update the URLs if you deploy the backend to a different origin.

## Loading the Extension

1. Clone or download the repository.
2. Visit `chrome://extensions` in Google Chrome.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and choose the `extension/` directory from this project.
5. Open Gmail in a new tab. Compose and send emails as usual—the extension will handle tracking automatically.

## Popup Controls

- **Tracking toggle**: Enables or disables tracking for new emails.
- **User identifier**: Enter an email or alias that matches the ID you use in the dashboard login. Defaults to `default` if left blank.

## Customization

- Replace the icons inside `extension/icons/` with your branding (PNG files at 16×16, 48×48, and 128×128 pixels).
- The popup UI styling lives in `popup.css`. Adjust typography or colors as needed.
- To disable notifications, remove the message handling in `background.js`.

## Privacy Notice

This extension tracks email opens and link clicks on purpose. Inform recipients that tracking pixels and redirect links are being used to comply with local laws and email policies.
