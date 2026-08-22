const GmailClient = require('../../services/gmail/gmailClient');

exports.handler = async (event, context) => {
  const code = event.queryStringParameters?.code;
  if (!code) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'text/html' },
      body: '<h3>Missing authorization code from Google OAuth.</h3>'
    };
  }

  try {
    const client = new GmailClient();
    const tokens = await client.exchangeCode(code);

    const refreshToken = tokens.refresh_token;
    const displayText = refreshToken ? 'A refresh token was returned.' : 'Refresh token not returned (already granted). Revoke access in Google security settings and reconnect to generate a new refresh token.';

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html' },
      body: `
        <!DOCTYPE html>
        <html>
        <head><title>Gmail OAuth Connected</title><style>body{font-family:system-ui;background:#0b0f19;color:#fff;padding:2rem;} .sensitive{background:#1f2937;padding:1rem;border-radius:8px;color:#60a5fa;}</style></head>
        <body>
          <h2>Gmail Intake Connected Successfully!</h2>
          <p><strong>Important:</strong> The refresh token is a sensitive secret. Do not share it. Store it securely in Netlify Environment Variables as <code>GMAIL_REFRESH_TOKEN</code>.</p>
          <p>${displayText}</p>
          ${refreshToken ? `<div class="sensitive"><strong>Copy this refresh token now and store it securely in Netlify:</strong><pre style="white-space:pre-wrap;">${refreshToken}</pre></div>` : ''}
          <p><a href="/dashboard/index.html#email-intake" style="color:#3b82f6;">Return to Gilbert Command Center</a></p>
        </body>
        </html>
      `
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'text/html' },
      body: `<h3>OAuth Token Exchange Failed</h3><p>${err.message}</p>`
    };
  }
};
