const GmailClient = require('../../services/gmail/gmailClient');

exports.handler = async (event, context) => {
  try {
    const client = new GmailClient();
    const authUrl = client.getAuthUrl();
    return {
      statusCode: 302,
      headers: {
        Location: authUrl,
        'Cache-Control': 'no-cache'
      },
      body: ''
    };
  } catch (err) {
    // If configuration is missing, return 400 with a helpful message
    const isConfigError = /Gmail OAuth configuration missing/.test(err.message);
    return {
      statusCode: isConfigError ? 400 : 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message })
    };
  }
};
