# Automatic Gmail → Gilbert Command Center Calendar Intake

## 1. Architecture Overview
Gilbert Command Center implements a serverless, least-privilege ingestion engine designed to process forwarded calendar invitations and meeting emails automatically.

```text
Forwarded Email to gilbert.cgpt+calendar@gmail.com
                   ↓
Gmail API Polling / Netlify Serverless Function (Least-Privilege OAuth)
                   ↓
Recursive MIME & Attachment Parser
                   ↓
Look for text/calendar or .ics
                   ↓
.ics Present?
  ├── YES ──> RFC 5545 ICS Parser (UID, SEQUENCE, METHOD, TZID) [High Confidence]
  └── NO  ──> Deterministic NLP (Date/Time/Duration/Links) 
               └── If Incomplete ──> Ollama AI Layer Schema Validation
                   ↓
Event Normalization & Pacific Timezone Alignment (America/Los_Angeles)
                   ↓
Duplicate / Lifecycle Detection:
  ├── METHOD:CANCEL ──> Mark CANCELLED (No duplicate)
  ├── Matching UID / Sequence Changed ──> Update Existing Event
  └── New Event ──> Auto Add (High Confidence) or Needs Review (Medium/Low)
                   ↓
Firestore (users/{uid}/events & users/{uid}/emailIntake)
                   ↓
Real-time Listener updates Command Center Calendar & Toast Notification
```

---

## 2. Gmail Account & Label Strategy
- **Intake Account**: `gilbert.cgpt@gmail.com`
- **Dedicated Plus Address**: `gilbert.cgpt+calendar@gmail.com`
- **Configurable Labels**:
  - `Command Center Intake` (Messages waiting for processing)
  - `Command Center Processed` (Processed messages)
  - `Command Center Needs Review` (Ambiguous items requiring user inspection)
   - `Command Center Ignored` (Past or intentionally ignored items)

Labels are created and managed by the backend. The user does not apply them manually.

---

## 3. Forwarding Workflow
You can receive interview invitations or appointments across any of your accounts (Personal, Recruiter, Job 1, Job 2, Job 3).
Simply forward the raw email/invitation to **`gilbert.cgpt+calendar@gmail.com`**.
No special subject line syntax (like `[CAL]` or `[INTERVIEW]`) is required.
Netlify invokes the shared Gmail processor every five minutes; **Check Gmail** remains an optional immediate-sync tool.

---

## 4. Ingestion Priority & Confidence Hierarchy

| Level | Ingestion Path | Confidence | Action |
|---|---|---|---|
| **High Confidence** | Valid `.ics` file with `DTSTART`, `DTEND`, and `UID` | `1.0` / `>= 0.85` | **AUTO ADD** directly to active Calendar without requiring manual approval |
| **Reschedule / Update** | Matching `UID` with newer `SEQUENCE` or modified time | `1.0` | **AUTO UPDATE** existing calendar event in place |
| **Cancellation** | `METHOD:CANCEL` or `STATUS:CANCELLED` matching `UID` | `1.0` | **AUTO CANCEL** event (status = `CANCELLED`) |
| **Medium Confidence** | Deterministic Natural Language or Ollama structured response | `0.70 – 0.84` | Added to Calendar with visible `Needs Review` badge |
| **Low Confidence** | Ambiguous time, missing date, or malformed text | `< 0.50` | Queued in `Email Intake → Needs Review` |

---

## 5. Security & Credentials
- **Zero Frontend Secrets**: All OAuth secrets and token exchanges run strictly inside server-side Netlify Functions (`netlify/functions/gmail-*`).
- **Least-Privilege Scope**: `https://www.googleapis.com/auth/gmail.modify`
- **Data Minimization**: Full email bodies are not stored permanently. Only lightweight metadata and extracted appointment attributes are persisted in Firestore.

---

## 6. Required Environment Variables
Configure these in your Netlify Dashboard or local `.env`:

```bash
GOOGLE_CLIENT_ID=your-google-oauth-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-oauth-client-secret
GOOGLE_REDIRECT_URI=https://gilbertbaidya.netlify.app/.netlify/functions/gmail-auth-callback
GMAIL_INTAKE_ACCOUNT=gilbert.cgpt@gmail.com
GMAIL_CALENDAR_INTAKE_ADDRESS=gilbert.cgpt+calendar@gmail.com
GMAIL_INTAKE_LABEL=Command Center Intake
GMAIL_REFRESH_TOKEN=your-oauth-refresh-token

FIREBASE_PROJECT_ID=gilbert-command-center-ff543
```

---

## 7. Step-by-Step Google Cloud Setup

1. **Google Cloud Console**:
   - Go to [Google Cloud Console](https://console.cloud.google.com/).
   - Select or create project `gilbert-command-center-ff543`.
2. **Enable Gmail API**:
   - Navigate to **APIs & Services** → **Library**.
   - Search for **Gmail API** and click **Enable**.
3. **OAuth Consent Screen**:
   - Select **External** (or Internal for Google Workspace).
   - Add App Name: `Gilbert Command Center`.
   - Add Authorized Domain: `netlify.app`.
   - Add Test User: `gilbert.cgpt@gmail.com`.
4. **Create OAuth Client ID**:
   - Go to **APIs & Services** → **Credentials** → **Create Credentials** → **OAuth Client ID**.
   - Application Type: **Web application**.
   - Authorized redirect URIs:
     - `https://gilbertbaidya.netlify.app/.netlify/functions/gmail-auth-callback`
     - `http://localhost:8888/.netlify/functions/gmail-auth-callback` (for local Netlify CLI dev)
5. **Connect & Generate Refresh Token**:
   - Visit `https://gilbertbaidya.netlify.app/.netlify/functions/gmail-auth-start` to authorize `gilbert.cgpt@gmail.com`.
   - Copy the returned `refresh_token` and save it to Netlify Environment Variables as `GMAIL_REFRESH_TOKEN`.

---

## 8. Local Development & Simulation
You can test the entire pipeline locally without connecting Google Cloud:
1. Open the dashboard at `http://localhost:8000/dashboard/index.html#email-intake`.
2. Click **Simulate Forwarded Email / ICS**.
3. Click any of the preset fixture buttons:
   - **Load Sample Interview (.ICS)**: Tests clean auto-add.
   - **Load Reschedule (.ICS)**: Tests in-place updating of existing events.
   - **Load Cancel (.ICS)**: Tests cancellation matching.
   - **Load Natural Language Email**: Tests deterministic 45-minute parsing with MS Teams links.
4. Click **Process Ingestion** and observe real-time calendar updates and toast alerts.
