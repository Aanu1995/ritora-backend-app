# Ritora Backend API

Ritora's backend is a NestJS API that handles authentication, secure session management, email verification, password reset, consent recording, skin profile storage, and health checks for the web app in `../ritora-user-webapp`.

## Current modules

- `auth` - registration, login, refresh, logout, verification, password reset, session listing, data export, account deletion
- `skin-profile` - options lookup plus create, read, update, and delete for a user's skin profile
- `health` - public health check endpoint
- `mail` - verification and password-reset email delivery

## Security model

The current backend keeps authentication in-house and is designed to avoid the common pitfalls of a homegrown auth system:

- Passwords are hashed with bcrypt before they are stored
- Password hashes and token hashes are excluded from normal entity selection with `select: false`
- Email-verification and password-reset tokens are random, single-use, and expiry-limited
- Only token hashes are stored in the database
- Registration does not create an authenticated session
- Login is blocked until the email address has been verified
- Refresh tokens are rotated and stored in an HTTP-only cookie
- Helmet, CORS, request validation, throttling, and global exception handling are enabled
- Verification and reset links use URL fragments such as `#token=...` so tokens do not travel as query params to the frontend server

## Tech stack

- NestJS 11
- TypeORM
- PostgreSQL
- JWT access tokens + rotating refresh-token cookies
- Nodemailer via `@nestjs-modules/mailer`
- Swagger/OpenAPI
- Jest + Supertest

## Prerequisites

- Node.js `>=20`
- npm `>=10`
- PostgreSQL

## Environment

Create `/.env` from `/.env.example` and fill in the secrets you need:

```bash
cp .env.example .env
```

Important groups:

- Database: `DATABASE_*`
- JWT: `JWT_SECRET`, `JWT_REFRESH_SECRET`, expiry, issuer, audience
- Cookie policy: `COOKIE_*`
- Auth security: `BCRYPT_SALT_ROUNDS`, verification/reset expiries
- Mail delivery: `MAIL_*`
- Frontend origin: `FRONTEND_URL`
- Legal consent versions: `LEGAL_TERMS_VERSION`, `LEGAL_PRIVACY_VERSION`

Production validation is intentionally strict:

- `FRONTEND_URL` must be HTTPS
- `COOKIE_SECURE` must be `true`
- JWT secrets must be set and long enough
- `MAIL_FROM` must be a valid email address

## Local development

1. Install dependencies.

```bash
npm install
```

2. Create local databases.

```bash
createdb ritora
createdb ritora_test
```

3. Configure `/.env`.

At minimum, confirm these values:

```bash
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=ritora
DATABASE_USER=postgres
DATABASE_PASSWORD=your-local-password
FRONTEND_URL=http://localhost:3000
CORS_ORIGINS=http://localhost:3000
```

`/.env.test` is already configured for `ritora_test`. If `DATABASE_PASSWORD` is omitted there, local test runs can inherit it from `/.env`.

4. Run database migrations.

```bash
npm run migration:run
```

5. Start the API.

```bash
npm run start:dev
```

6. Open:

- API base: `http://localhost:3001/api/v1`
- Swagger docs: `http://localhost:3001/api/docs`
- Health check: `http://localhost:3001/api/v1/health`

## Local email

The default development setup sends mail to Mailpit, not to a real inbox.

- SMTP listener: `localhost:1025`
- Mail UI: `http://localhost:8025`

If you want real delivery, replace `MAIL_HOST`, `MAIL_PORT`, `MAIL_USER`, and `MAIL_PASS` with a real SMTP provider and restart the API.

## Auth flow summary

1. `POST /auth/register`
   Creates an unverified user, records required consent versions, and sends a verification email.
2. `POST /auth/verify-email`
   Activates the account by validating the one-time token.
3. `POST /auth/login`
   Returns an access token and sets the refresh cookie, but only for verified users.
4. `POST /auth/refresh`
   Rotates the refresh token and returns a fresh access token.
5. `POST /auth/logout` and `POST /auth/logout-all`
   Revokes the current or all sessions.

Other account endpoints include:

- `POST /auth/resend-verification`
- `POST /auth/forgot-password`
- `POST /auth/reset-password`
- `GET /auth/me`
- `GET /auth/sessions`
- `POST /auth/export`
- `DELETE /auth/account`

## Skin profile endpoints

- `GET /skin-profile/options`
- `GET /skin-profile`
- `POST /skin-profile`
- `PATCH /skin-profile`
- `DELETE /skin-profile`

These routes are authenticated. The public `options` endpoint exposes the allowed enums used by the frontend form.

## Scripts

```bash
npm run start
npm run start:dev
npm run start:debug
npm run start:prod

npm run build
npm run lint
npm run format

npm run test
npm run test:watch
npm run test:cov
npm run test:e2e

npm run migration:run
npm run migration:revert
npm run migration:generate -- src/database/migrations/YourMigrationName
```

Note: `npm run lint` runs ESLint with `--fix`, so it can rewrite files.

## Testing

- Unit and controller/service tests run with `npm run test`
- Coverage runs with `npm run test:cov`
- End-to-end runs with `npm run test:e2e`

E2E notes:

- Uses `/.env.test`
- Expects the `ritora_test` database
- Runs serially with `maxWorkers: 1` to avoid cross-suite database interference
- Mail delivery is mocked in tests

## Project layout

- `src/auth` - auth controllers, services, DTOs, sessions, strategies
- `src/skin-profile` - skin profile DTOs, controller, service, entity
- `src/users` - user entity, consent entity, and user service
- `src/mail` - mail service and Handlebars templates
- `src/database` - TypeORM data source and migrations
- `test` - e2e test setup and specs

## Related repo

Frontend app: `../ritora-user-webapp`
