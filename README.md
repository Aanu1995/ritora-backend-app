# Ritora Backend API

Ritora's backend is a NestJS API for authentication, user settings, skin profiles, schedule management, shelf inventory, and photo-first product extraction for the frontend in `../ritora-user-webapp`.

## Current modules

- `auth` - registration, login, refresh, logout, logout-all, verification, password reset, session listing, data export, and account deletion
- `users` - current-user profile, preferred language, and time-zone updates
- `skin-profile` - options lookup plus create, read, update, and delete for a user's skin profile
- `schedule` - slot CRUD, presets, movement, and routine-step management
- `inventory` - shelf product CRUD, stats, filtering, bulk actions, and direct product-image upload
- `catalogue` - photo-first product extraction, official-page completion, and product media handling
- `mail` - verification and reset email delivery
- `health` - public health endpoint

## Tech stack

- NestJS 11
- TypeORM
- PostgreSQL
- JWT access tokens + rotating refresh-token cookies
- Resend email delivery + Handlebars templates
- OpenAI Responses API for product extraction
- Sharp for product-photo processing
- AWS S3 + private CloudFront media support
- Jest + Supertest

## Security model

- Passwords are hashed with bcrypt before storage.
- Password hashes, reset token hashes, and verification token hashes are not selected in normal entity reads.
- Refresh tokens are rotated and stored as hashes in `auth_sessions`.
- Cookie-affecting auth routes use origin checks in addition to CORS.
- Helmet, validation, throttling, exception filtering, and JWT guards are enabled globally.
- Inventory, schedule, skin-profile, and user endpoints are scoped to the authenticated user.
- Product and manufacturer URLs are validated before they are accepted into shelf payloads.
- Environment validation is strict in production for JWT, cookie, CORS, and web-app origin settings.

## Prerequisites

- Node.js `>=20`
- npm `>=10`
- PostgreSQL

## Environment

Create `/.env` from `/.env.example`:

```bash
cp .env.example .env
```

Important variable groups:

- Database: `DATABASE_*`
- Web app / CORS: `WEB_APP_URL`, `API_PUBLIC_URL`, `CORS_ORIGINS`
- JWT: `JWT_SECRET`, `JWT_REFRESH_SECRET`, expiry, issuer, audience
- Cookies: `COOKIE_*`
- Auth security: `BCRYPT_SALT_ROUNDS`, verification/reset expiries
- Mail: `RESEND_API_KEY`, `MAIL_FROM`, `NOTIFICATION_MAIL_FROM`, `MAIL_UNSUBSCRIBE_SECRET`
- OpenAI: `OPENAI_API_KEY`, `OPENAI_MODEL`, feature-specific model keys such as `SUGGESTION_AI_MODEL`
- Product extraction reasoning: `OPENAI_PRODUCT_DISCOVERY_REASONING_EFFORT` (`low` recommended)
- Optional product web enrichment: `OPENAI_PRODUCT_DISCOVERY_WEB_REASONING_EFFORT` (`none` recommended)
- Ingredient product analysis queue: `INGREDIENT_ANALYSIS_QUEUE_DRIVER` (`database` or `sqs`), `INGREDIENT_ANALYSIS_SQS_QUEUE_URL`, optional `INGREDIENT_ANALYSIS_SQS_DLQ_URL`
- Skin Journal analysis cost metadata: `SKIN_JOURNAL_ANALYSIS_INPUT_TOKEN_COST_PER_1M_USD`, `SKIN_JOURNAL_ANALYSIS_OUTPUT_TOKEN_COST_PER_1M_USD`
- Skin Journal analysis queue: `SKIN_JOURNAL_ANALYSIS_QUEUE_DRIVER` (`database` or `sqs`), `SKIN_JOURNAL_ANALYSIS_SQS_QUEUE_URL`, optional `SKIN_JOURNAL_ANALYSIS_SQS_DLQ_URL`
- Smart Picks queue: `SMART_PICKS_QUEUE_DRIVER` (`database` or `sqs`), `SMART_PICKS_SQS_QUEUE_URL`, optional `SMART_PICKS_SQS_DLQ_URL`
- Workers: run `npm run start:workers` in the worker deployment so API instances enqueue background work while the worker service processes Skin Journal, Smart Picks, account, monitoring, and ingredient-analysis jobs.
- Skin Journal operations: `SKIN_JOURNAL_OPERATIONS_TOKEN`
- Product media: `AWS_REGION`, `PRODUCT_MEDIA_*`
- Legal consent versions: `LEGAL_TERMS_VERSION`, `LEGAL_PRIVACY_VERSION`

Production validation requires:

- `WEB_APP_URL` to be HTTPS
- `API_PUBLIC_URL` to be HTTPS and include the API prefix, for example `https://api.example.com/api/v1`
- `COOKIE_SECURE=true`
- non-empty strong JWT secrets
- a stable `MAIL_UNSUBSCRIBE_SECRET` with at least 32 characters
- `INGREDIENT_ANALYSIS_QUEUE_DRIVER=sqs` with a non-empty HTTPS `INGREDIENT_ANALYSIS_SQS_QUEUE_URL`
- `SMART_PICKS_QUEUE_DRIVER=sqs` with a non-empty HTTPS `SMART_PICKS_SQS_QUEUE_URL`
- a valid `MAIL_FROM` for auth emails
- a valid `NOTIFICATION_MAIL_FROM` for notification emails, different from `MAIL_FROM`
- valid `CORS_ORIGINS` when configured

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

Minimum local values:

```bash
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=ritora
DATABASE_USER=postgres
DATABASE_PASSWORD=your-local-password
WEB_APP_URL=http://localhost:3000
API_PUBLIC_URL=http://localhost:3001/api/v1
CORS_ORIGINS=http://localhost:3000
JWT_SECRET=dev-jwt-secret-change-me
JWT_REFRESH_SECRET=dev-refresh-secret-change-me
```

4. Run migrations.

```bash
npm run migration:run
```

5. Start the API.

```bash
npm run start:dev
```

To run the API and all local workers together during development, use the
source-based dev runner. This avoids starting workers from `dist` while the Nest
watch compiler is rebuilding that folder. When
`ACCOUNT_MONITORING_QUEUE_DRIVER=sqs` and `ACCOUNT_MONITORING_SQS_QUEUE_URL` are
configured, this also starts the account monitoring SQS worker. The ingredient
product analysis worker is included here so shelf product analysis is queued by
the API and processed outside the API process. It also starts the Skin Journal
analysis and insight workers so local insight generation matches the worker
deployment shape.

```bash
npm run start:dev:all
```

For deployment, keep the API service on the normal backend command and run all
background workers from one worker service:

```bash
npm run start:prod
npm run start:workers
```

To run the Skin Journal analysis evaluation once before starting the API and
workers:

```bash
npm run start:dev:all:evaluate
```

6. Useful local URLs:

- API base: `http://localhost:3001/api/v1`
- Health: `http://localhost:3001/api/v1/health`
- Swagger: `http://localhost:3001/api/docs` when `SWAGGER_ENABLED=true`

## Product photos and media

- Product extraction is photo-first through `POST /catalogue/products/extract-from-images`.
- Product images are normalized with Sharp before extraction and storage.
- Persistent product-image storage is remote-only.
- Set `PRODUCT_MEDIA_BUCKET`, `PRODUCT_MEDIA_CLOUDFRONT_URL`, `PRODUCT_MEDIA_CLOUDFRONT_KEY_PAIR_ID`, and `PRODUCT_MEDIA_CLOUDFRONT_PRIVATE_KEY` to enable saved product images.
- Without remote media config, product extraction can still return structured data, but persistent image saving is unavailable.

## Email delivery

- Verification and reset emails are sent through Resend.
- In development, failed email delivery logs fallback action URLs so auth flows can still be tested.

## API areas

Auth:

- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout`
- `POST /auth/logout-all`
- `POST /auth/verify-email`
- `POST /auth/resend-verification`
- `POST /auth/forgot-password`
- `POST /auth/reset-password`
- `GET /auth/me`
- `GET /auth/sessions`
- `POST /auth/export`
- `DELETE /auth/account`

Users:

- `GET /users/me`
- `PATCH /users/me`
- `PATCH /users/me/language`
- `PATCH /users/me/time-zone`

Skin profile:

- `GET /skin-profile/options`
- `GET /skin-profile`
- `POST /skin-profile`
- `PATCH /skin-profile`
- `DELETE /skin-profile`

Schedule:

- `GET /schedule`
- `GET /schedule/today`
- `POST /schedule/slots`
- `POST /schedule/slots/batch`
- `POST /schedule/apply-preset`
- `PATCH /schedule/slots/:id`
- `DELETE /schedule/slots/:id`
- `PUT /schedule/slots/:id/steps`
- `POST /schedule/slots/:id/move`

Shelf / inventory:

- `GET /inventory/products`
- `GET /inventory/products/stats`
- `POST /inventory/products`
- `POST /inventory/products/upload-image`
- `GET /inventory/products/:id`
- `PATCH /inventory/products/:id`
- `POST /inventory/products/:id/archive`
- `POST /inventory/products/:id/restore`
- `POST /inventory/products/:id/mark-finished`
- `DELETE /inventory/products/:id`
- `POST /inventory/products/bulk/archive`
- `POST /inventory/products/bulk/restore`
- `POST /inventory/products/bulk/mark-finished`
- `POST /inventory/products/bulk-delete`

Catalogue:

- `POST /catalogue/products/extract-from-images`

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

Notes:

- `npm run lint` runs ESLint with `--fix`.
- The backend currently uses dependency overrides to pin secure transitive versions for `fast-xml-parser` and `uuid`.

## Testing

- `npm run test` runs unit and service/controller tests.
- `npm run test:e2e` runs the full API e2e suite, including shelf/inventory coverage.
- `/.env.test` is used for e2e and expects the `ritora_test` database.
- E2E runs serially with `maxWorkers: 1`.

## Project layout

- `src/auth` - auth controllers, services, DTOs, strategy, sessions
- `src/users` - user and consent entities plus user service/controller
- `src/skin-profile` - skin profile DTOs, entity, service, controller
- `src/schedule` - schedule entities, DTOs, controller, service
- `src/inventory` - shelf entities, DTOs, controller, service, list/snapshot helpers
- `src/catalogue` - photo extraction, official-page completion, media processing/storage
- `src/mail` - email service and templates
- `src/common` - guards, filters, interceptors, utilities, i18n
- `src/database` - data source and migrations
- `test` - backend e2e setup and specs

## Related repo

Frontend app: `../ritora-user-webapp`
