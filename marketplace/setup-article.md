# Asana AirSync

The Asana Integration enables bidirectional synchronization between Asana and DevRev, supporting one-time imports, forward syncs (Asana to DevRev), and reverse syncs (DevRev to Asana).

## Supported objects

| Asana object | DevRev object | Sync to DevRev | Sync to Asana |
| --- | --- | --- | --- |
| Task | Issue | Yes | Yes |
| Subtask | Issue | Yes | Yes |
| Attachment | Attachment | Yes | Yes |
| Comment | Comment | Yes | Create only |
| Link (subtask, dependency) | Link | Yes | Yes |
| User | DevUser | Yes | No |
| Tag | Tag | Yes | No |
| Team | Group | Yes | No |
| Team membership | Group membership | Yes | No |
| Project permission | Access rule | Yes | No |

## Connect to Asana

The connector supports two authentication methods:

- OAuth — recommended for production. You authorize DevRev via Asana's OAuth flow, and DevRev securely stores and refreshes the access token.

- Personal Access Token (PAT) — a token generated from your Asana account (Developer Console > Personal Access Token). Simpler to set up; recommended for development and testing.

Either way, the connecting Asana account must have access to the workspace and project you want to sync. Non-admin accounts only see projects they're a member of — private projects they aren't a member of, and any content visible only to guests, won't appear. Use a workspace admin account for full visibility.

## Limitations

- Asana does not natively provide a priority field. All imported issues are assigned priority P2 by default.

- Task stage is derived from the Asana section the task belongs to within the synced project (for subtasks, from their completed/open status); if a task belongs to multiple Asana projects, only its section membership in the selected project is used. Sections are mapped to custom stages during import.

- Subtask depth is limited to 2 levels (task → subtask → sub-subtask) due to DevRev platform constraints.

- Custom fields defined on Asana tasks (text, number, dropdown, multi-select, date, and people types) are synced bidirectionally.

- Comments synced from DevRev to Asana are create-only. Asana does not support updating or deleting comments via its API.

- Users, tags, teams, and permissions are forward-only (Asana to DevRev) and cannot be synced back to Asana.

- Rate limits: Asana API rate limits (429 responses) are retried automatically with backoff. Sustained rate limiting can delay a sync run.

## Import from Asana

To perform a one-time import from Asana to DevRev:

1. Go to [Settings > Integrations > AirSyncs](https://app.devrev.ai/?setting=airsyncs).

2. Click +Import and select Asana.

3. Connect your Asana account and select the project to import.

Asana tasks are imported as DevRev issues with automatic field mapping.

## Sync from Asana to DevRev

After the initial import, you can sync updates made in Asana to the previously imported issues in DevRev. All supported object types belonging to the imported project — tasks, subtasks, users, tags, comments, attachments, links, teams, and project permissions — are synced together in a single run. Syncs after the first are incremental: only tasks, subtasks, comments, and attachments created or modified since the last successful sync are re-extracted. You can also configure a custom time window for a sync.

To perform a one-time sync from Asana to DevRev:

1. Go to [Settings > Integrations > AirSyncs](https://app.devrev.ai/?setting=airsyncs).

2. Locate the imported Asana project.

3. Select ⋮ > Sync Asana to DevRev.

## Sync from DevRev to Asana

After a successful import from an Asana project, you can sync changes made in DevRev back to Asana. Additionally, any new DevRev issues marked for sync are created as new Asana tasks.

To perform a one-time sync from DevRev to Asana:

1. Go to [Settings > Integrations > AirSyncs](https://app.devrev.ai/?setting=airsyncs).

2. Locate the previously imported Asana project.

3. Select ⋮ > Sync DevRev to Asana.
