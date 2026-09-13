# Real Money Income BD — V2

## Architecture
- Frontend: HTML/CSS/JavaScript
- Authentication: Firebase Authentication (Email/Password)
- Database: Firebase Realtime Database
- Server: Node.js + Express + Firebase Admin SDK
- Hosting: Render Web Service
- Admin authorization: server-side `ADMIN_EMAILS`
- Firebase client database is locked down; database writes happen through the server.

## Firebase
1. Enable Authentication → Email/Password.
2. Create/enable Realtime Database.
3. Firebase Project Settings → Web App: copy `apiKey` and `appId`.
4. Replace `PASTE_YOUR_API_KEY` and `PASTE_YOUR_APP_ID` in `public/index.html` and `public/admin.html`.
5. Set the Realtime Database rules from `database.rules.json`.
6. Create a Firebase service account: Project settings → Service accounts → Generate new private key.
7. On Render, store the complete service-account JSON in the `FIREBASE_SERVICE_ACCOUNT_JSON` environment variable.
8. Set `ADMIN_EMAILS` to one or more admin emails, comma-separated.

## Render
Deploy as a Web Service from GitHub:
- Build Command: `npm install`
- Start Command: `npm start`

`render.yaml` is included for Blueprint deployment.

## Seed task
`seed.tasks.json` contains an example task. Add it to Realtime Database under `/tasks` using Firebase Console, or create tasks later with an admin tool.

## Security model
The browser never gets Firebase Admin credentials. Admin actions use verified Firebase ID tokens and server-side email allow-listing. Keep service-account JSON only in Render environment variables.

## Money/payment note
V2 implements a request/review ledger, not a payment gateway. Deposit and withdrawal approval does not itself send money. To accept real deposits or send real withdrawals, integrate a legitimate provider on the server with provider-side verification/webhooks, idempotency, fraud controls, limits, audit logs, and applicable Bangladesh legal/tax/payment requirements.
