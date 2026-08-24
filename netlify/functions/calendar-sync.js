/**
 * calendar-sync.js — Netlify Function
 * Server-side Google Calendar API proxy.
 * Accepts { action, eventId, firestoreEventId, title, start, end, timezone,
 *           reminderMinutes, googleCalendarEventId, meetingUrl }
 * Returns { googleCalendarEventId, calendarLink }
 *
 * Security: All credentials stay server-side. No secrets exposed to frontend.
 */

const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const CALENDAR_ID = 'primary';
const InterviewTimeEngine = require('../../services/calendar/interviewTimeEngine');

async function getAccessToken() {
  // Trim to guard against trailing whitespace/newlines pasted into env var storage, which Google rejects as invalid_grant
  const clientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || '').trim();
  const refreshToken = (process.env.GMAIL_REFRESH_TOKEN || '').trim(); // reuse same refresh token — scopes merged

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Google Calendar credentials not configured (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GMAIL_REFRESH_TOKEN)');
  }

  // Safe, secret-free diagnostics for invalid_grant troubleshooting — never log actual credential values
  console.debug('[calendar-sync] OAuth diagnostics', {
    GOOGLE_CLIENT_ID_configured: Boolean(clientId),
    GOOGLE_CLIENT_ID_suffix: clientId.slice(-6),
    GOOGLE_CLIENT_SECRET_configured: Boolean(clientSecret),
    GMAIL_REFRESH_TOKEN_configured: Boolean(refreshToken),
    GMAIL_REFRESH_TOKEN_length: refreshToken.length,
    GMAIL_REFRESH_TOKEN_rawEnvLength: (process.env.GMAIL_REFRESH_TOKEN || '').length
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google token refresh failed: ${err}`);
  }

  const data = await res.json();
  return data.access_token;
}

function buildCalendarEvent(payload) {
  const { title, start, end, timezone, reminderMinutes, meetingUrl, description } = payload;
  const tz = InterviewTimeEngine.DEFAULT_TIME_ZONE;

  // Reminder overrides — default interview set if none provided
  const rawMinutes = Array.isArray(reminderMinutes) && reminderMinutes.length > 0
    ? reminderMinutes
    : [1440, 60, 30, 15, 5];

  const overrides = [...new Set(rawMinutes.map(Number).filter(Number.isFinite))]
    .map(minutes => ({ method: 'popup', minutes }));

  const event = {
    summary: title || 'Gilbert Command Center Event',
    description: description || '',
    start: { dateTime: new Date(start).toISOString(), timeZone: tz },
    end: { dateTime: new Date(end).toISOString(), timeZone: tz },
    reminders: { useDefault: false, overrides }
  };

  if (meetingUrl && /^https?:\/\//.test(meetingUrl)) {
    event.conferenceData = null;
    event.location = meetingUrl;
    event.description = (event.description ? event.description + '\n\n' : '') + `Meeting: ${meetingUrl}`;
  }

  return event;
}

async function createCalendarEvent(accessToken, payload) {
  const calEvent = buildCalendarEvent(payload);
  const url = `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(CALENDAR_ID)}/events`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(calEvent)
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Create calendar event failed: ${err}`);
  }

  const data = await res.json();
  return { googleCalendarEventId: data.id, calendarLink: data.htmlLink };
}

async function updateCalendarEvent(accessToken, googleCalendarEventId, payload) {
  const calEvent = buildCalendarEvent(payload);
  const url = `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(CALENDAR_ID)}/events/${encodeURIComponent(googleCalendarEventId)}`;

  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(calEvent)
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Update calendar event failed: ${err}`);
  }

  const data = await res.json();
  return { googleCalendarEventId: data.id, calendarLink: data.htmlLink };
}

async function deleteCalendarEvent(accessToken, googleCalendarEventId) {
  const url = `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(CALENDAR_ID)}/events/${encodeURIComponent(googleCalendarEventId)}`;

  const res = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  // 204 = success, 404 = already gone — both are acceptable
  if (!res.ok && res.status !== 404) {
    const err = await res.text();
    throw new Error(`Delete calendar event failed: ${err}`);
  }

  return { deleted: true };
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { action, googleCalendarEventId } = payload;

  if (!action) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required field: action' }) };
  }

  try {
    const accessToken = await getAccessToken();

    if (action === 'CREATE') {
      const result = await createCalendarEvent(accessToken, payload);
      return { statusCode: 200, headers, body: JSON.stringify({ status: 'CREATED', ...result }) };
    }

    if (action === 'UPDATE') {
      if (!googleCalendarEventId) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'UPDATE requires googleCalendarEventId' }) };
      }
      const result = await updateCalendarEvent(accessToken, googleCalendarEventId, payload);
      return { statusCode: 200, headers, body: JSON.stringify({ status: 'UPDATED', ...result }) };
    }

    if (action === 'DELETE') {
      if (!googleCalendarEventId) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'DELETE requires googleCalendarEventId' }) };
      }
      const result = await deleteCalendarEvent(accessToken, googleCalendarEventId);
      return { statusCode: 200, headers, body: JSON.stringify({ status: 'DELETED', ...result }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: `Unknown action: ${action}` }) };

  } catch (err) {
    console.error('[calendar-sync] Error:', err.message);

    // If credentials are not configured, return STANDBY (not a hard error)
    if (err.message.includes('not configured')) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ status: 'STANDBY', message: 'Google Calendar credentials not configured. Event saved to Firestore only.' })
      };
    }

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Calendar sync failed', details: err.message })
    };
  }
};

exports.buildCalendarEvent = buildCalendarEvent;
