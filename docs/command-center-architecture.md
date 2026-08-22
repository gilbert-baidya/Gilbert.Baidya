# Gilbert Command Center — Architecture (draft)

Overview:
- Public personal website remains static HTML/CSS/JS in project root.
- Private dashboard lives under `/dashboard` and is a client-side SPA that uses Firebase Auth and Firestore for persistent private data.

Key folders:
- `dashboard/` — dashboard HTML, styles, and client JS.
- `firebase-config.json` (gitignored) — runtime Firebase web config for deploy.
- `firestore.rules` — initial Firestore security rules restricting access to own user documents.

Auth:
- Firebase Authentication (Google Sign-In) is used.
- Only `gilbert.cgpt@gmail.com` is allowed initially; UI rejects others and signs them out.

Data model (Firestore):
- `users/{userId}/events/{eventId}` — calendar events
- `users/{userId}/tasks/{taskId}` — tasks
- `users/{userId}/interviews/{interviewId}` — interviews
- `users/{userId}/opportunities/{id}` — job opportunities
- `users/{userId}/emailIntake/{id}` — email intake items

Notes & Next steps:
- This initial commit provides authentication guard, basic event CRUD, conflict detection, and a FullCalendar-powered calendar view.
- Add server-side Netlify Functions for Gmail/Calendar OAuth later (do NOT place secrets in frontend).
- Add Ollama AI adapter as an optional provider behind a server proxy or callable function.
- Expand UI modules (interviews, jobs, tasks, email-intake) into separate components and add TypeScript types and tests.
