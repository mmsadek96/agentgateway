# AgentTrust Heroku Add-on

Heroku Add-on provider integration for AgentTrust. This service implements the Heroku Add-on Partner API, allowing Heroku users to provision AgentTrust directly from the Heroku Marketplace.

## Development

```bash
# Install dependencies
npm install

# Copy env and configure secrets
cp .env.example .env

# Run in development mode
npm run dev

# Build for production
npm run build
npm start
```

## Registering with Heroku

1. Install the Heroku CLI and the `addons-admin` plugin:
   ```bash
   heroku plugins:install addons-admin
   ```

2. Replace the placeholder values in `addon-manifest.json` (`api.password` and `api.sso_salt`) with secure random strings. Set the same values in your `.env` file.

3. Push the manifest to Heroku:
   ```bash
   heroku addons:admin:manifest:push
   ```

4. Deploy this service and ensure the production `base_url` in the manifest points to it.

## How Provisioning Works

1. A Heroku user adds the AgentTrust add-on to their app.
2. Heroku sends a `POST /heroku/resources` request with the resource UUID and selected plan.
3. This service registers a developer and agent with the AgentTrust Station API.
4. Config vars (`AGENTTRUST_STATION_URL`, `AGENTTRUST_API_KEY`, `AGENTTRUST_AGENT_ID`) are returned and injected into the user's Heroku app.
5. Plan changes hit `PUT /heroku/resources/:id` and deprovisioning hits `DELETE /heroku/resources/:id`.

## SSO

When a user clicks the AgentTrust add-on in the Heroku dashboard, Heroku performs an SSO handshake via `POST /heroku/sso`. The token is verified using a SHA-1 HMAC of `resource_id:sso_salt:timestamp`, and the user is redirected to the AgentTrust dashboard.

## Plans

| Plan    | Agents | Actions/Month | Price   |
|---------|--------|---------------|---------|
| Free    | 3      | 1,000         | $0      |
| Starter | 25     | 50,000        | $49/mo  |
| Pro     | 500    | 1,000,000     | $199/mo |
