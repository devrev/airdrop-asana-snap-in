# ADaaS Template

This GitHub repository provides a template with example code to implement an Airdrop as a Service (ADaaS) snap-in.

## Prerequisites

1. Install [DevRev CLI](https://developer.devrev.ai/snapin-development/references/cli-install) by following the instructions as per the Operating System.
2. Install [jq](https://jqlang.github.io/jq/download/).
3. Install [Node.js](https://nodejs.org/en/download/).
4. Install [ngrok](https://ngrok.com/download).

## Getting Started

1. Create a new repository:
   - Create a new repository from this template by clicking the "Use this template" button in the upper right corner and then "Create a new repository".
   - The repository name must start with `airdrop-` (e.g., `airdrop-<external system>-snap-in`).
2. Open the project in your IDE and authenticate to your DevRev organization using the DevRev CLI:
   ```bash
   devrev profiles authenticate --org <your DevRev Organization slug>
   ```
3. Install the Snap-in dependencies from the `code` directory:
   ```bash
   npm ci
   ```
4. Start the Snap-in development server from the `code` directory:
   ```bash
   npm run test:server -- local
   ```
   This will start the Snap-in server on `http://localhost:8000`.
5. Start the ngrok tunnel in a separate terminal window:
   ```bash
   ngrok http 8000
   ```
   This will create a tunnel to your local server.
   The ngrok forwarding URL will be displayed in the terminal window.
6. Copy the ngrok forwarding URL and create a new Snap-in version and Snap-in package using the DevRev CLI:
   ```bash
   devrev snap_in_version create-one  --manifest ./manifest.yaml --create-package --testing-url <ngrok forwarding URL>
   ```
7. Create a Snap-in draft using the DevRev CLI:
   ```bash
   devrev snap_in draft
   ```
8. After the Snap-in draft is created, install the Snap-in in the DevRev UI (`Settings` -> `Snap-ins` -> `Installed` -> `<your Snap-in>` -> `Install snap-in`) or using the DevRev CLI:
   ```bash
   devrev snap_in activate
   ```
9. Start the import (`Airdrops` -> `Start Airdrop` -> `<your Snap-in>`).

## Build, Deploy and Run

1. Open the project in your IDE and set up project environment variables, by following these steps:
   - Rename `.env.example` to `.env`.
   - In `.env` set the slug of your organization, and your email.
2. Build the Snap-in using the following command:
   ```bash
   make build
   ```
3. Deploy the Snap-in to the organization:
   ```bash
   make deploy
   ```
   NOTE: This process may take some time.
   The command authenticates you to the org using the DevRev CLI,
   creates a snap-in package, its snap-in version, and finally the snap-in draft.
4. After the Snap-in draft is created, install the Snap-in in the DevRev UI (`Settings` -> `Snap-ins` -> `Installed` -> `<your Snap-in>` -> `Install snap-in`) or using the DevRev CLI:
   ```bash
   devrev snap_in activate
   ```
5. Start the import (`Airdrops` -> `Start Airdrop` -> `<your Snap-in>`).

## Common Pitfalls

- `Conflict` error after the `Creating snap-in package...` output during `make deploy`.
  - Snap-in package with the same slug already exists. Override the `SNAP_IN_SLUG` variable by explicitly updating the variable in `scripts/vars.sh`.
- Snap-in version `build/deployment failed` after the `Waiting for snap-in version to be ready...` message
  - The snap-in version could not be built. Check the logs by running the DevRev CLI command `devrev snap_in_package logs`. For prettier UI, pipe the output to `jq`
- `Token is expired` when deploying or cleaning up.
  - Authentication token to the `DEV_ORG` has expired. Run `make auth` to reconnect to the organization.
