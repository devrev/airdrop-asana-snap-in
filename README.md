# Asana AirSync Connector

![Coverage](https://img.shields.io/badge/coverage-0%25-red)

Internal repository for the Asana AirSync connector. This is the source that gets deployed to the DevRev marketplace. See the [public repository](https://github.com/devrev/airdrop-asana-snap-in) for example implementation and the [Asana AirSync documentation](https://developer.devrev.ai/snap-in-development/tutorials/airsync/asana) for detailed setup and usage instructions.

## Prerequisites

- Node.js 18+
- [DevRev CLI](https://developer.devrev.ai/snap-in-development/references/cli-install)
- DevRev organization
- [jq](https://stedolan.github.io/jq/download/)
- [ngrok](https://ngrok.com/download) (for local development)
- Asana workspace

## Setup

### 1. Clone the repository

### 2. Configure environment

```bash
cd code
cp .env.example .env
```

Fill in your values in `.env`:

```
DEV_ORG=your-org
USER_EMAIL=your@email.com
ENV=prod
```

### 3. Configure Asana Authentication

This connector supports two authentication methods. Choose the one that best fits your needs:

#### Option A: Personal Access Token (PAT)

Recommended for development and quick testing.

**Generate Asana PAT:**

1. Go to [Asana Developer Console](https://app.asana.com/0/my-apps)
2. Click **Create new token** in the Personal Access Token section
3. Enter a name for the token and it will be generated

> **Note:** The PAT has the same permissions and access as the user who created it.

**Configure Manifest for PAT:**

Before deploying, comment out OAuth-related configuration in `manifest.yaml`:

- Comment out the entire `developer_keyrings` section (lines 29-32)
- Comment out the entire `asana-oauth-connection` keyring type (lines 35-81)
- Remove `asana-oauth-connection` from `allowed_connection_types` (line 115)

---

#### Option B: OAuth

Recommended for production use. More secure and reliable.

**1. Create Asana OAuth App:**

1. Go to [Asana Developer Console](https://app.asana.com/0/my-apps)
2. Under **My apps**, click **Create new app**
3. Enter an app name and select **API app**
4. Navigate to **OAuth** tab and copy your **Client ID** and **Client Secret**

**2. Login to DevRev CLI:**

Before creating the developer keyring, you must be logged into your DevRev organization:

```bash
devrev profiles authenticate --env <ENV> --org <DEV_ORG> --usr <USER_EMAIL>
```

**3. Create Developer Keyring in DevRev:**

Add your Asana OAuth credentials to `.env`:

```
ASANA_CLIENT_ID=your-asana-client-id
ASANA_CLIENT_SECRET=your-asana-client-secret
```

Then run the keyring creation script:

```bash
npm run create-keyring
```

Alternatively, you can run the command manually:

```bash
echo '{"client_id":"<YOUR_ASANA_CLIENT_ID>","client_secret":"<YOUR_ASANA_CLIENT_SECRET>"}' | devrev developer_keyring create oauth-secret asana-oauth-secret
```

**4. Configure Redirect URI in Asana:**

In the **OAuth** tab of your Asana app, set the **Redirect URL** based on your DevRev environment:

| Environment | Redirect URL                                       |
| ----------- | -------------------------------------------------- |
| DEV         | `https://api.dev.devrev-eng.ai/keyrings.authorize` |
| QA          | `https://api.qa.devrev-eng.ai/keyrings.authorize`  |
| PROD        | `https://api.devrev.ai/keyrings.authorize`         |

This URL is where Asana redirects after the user authorizes the app, allowing DevRev to complete the OAuth flow and securely store the access token.

**5. Configure Permission Scopes:**

1. Go to **Permission scopes** section in the OAuth tab
2. Click **Full permissions** button to enable all scopes

> **Note:** Specific required scopes will be documented in a future update.

**6. Configure Distribution:**

1. Go to **Manage distribution** tab
2. Set the app to be **available to any workspace**

### 4. Install dependencies

```bash
npm ci
```

### 5. Development

```bash
cd code
npm run build        # Compile TypeScript and resolve path aliases
npm run lint         # Run ESLint
npm run lint:fix     # Auto-fix lint issues
```

The source code lives under `code/src/` with path aliases `@utils`, `@asana`, and `@functions` defined in `tsconfig.json`.

### 6. Testing

```bash
cd code
npm test                # Run all tests
npm test -- --coverage  # Run tests with coverage report
```

Tests use Jest with `ts-jest`. Coverage thresholds are configured in `jest.config.js`. Test files are co-located with source files using the `*.test.ts` naming convention.

### 7. Deploy

```bash
npm run deploy
```

- When prompted, enter the snap-in package slug
- For OAuth: select the developer keyring `asana-oauth-secret`

### 8. Start AirSync

1. Go to **Settings** -> **AirSyncs** -> **Start AirSync**
2. Select the Asana connector
3. **For PAT:** Enter a connection name and paste the generated PAT token
4. **For OAuth:** Choose **Asana OAuth Connection**, authorize in the popup window, and proceed with the data import
