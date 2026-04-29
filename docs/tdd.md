# Asana AirSync - Technical Design Document

| Field         | Value                                                                                      |
| :------------ | :----------------------------------------------------------------------------------------- |
| Solution name | Asana AirSync Connector                                                                    |
| Author        | Radovan Jorgić                                                                             |
| Status        | Beta — extraction (incl. permissions) and loading complete for all P0 record types         |
| Created On    | December 2025                                                                              |
| Repository    | [airdrop-asana-snap-in-internal](https://github.com/devrev/airdrop-asana-snap-in-internal) |
| PRD           | [docs/prd.md](../docs/prd.md)                                                              |

# 1. Product Overview

This document describes the AirSync connector for [Asana](https://asana.com/), enabling bidirectional synchronization between Asana and DevRev. The connector extracts tasks, subtasks, users, tags, comments, attachments, links (parent-child and dependency relationships), groups (teams), group memberships, and access rules (project permissions) from Asana projects into DevRev. Loading (DevRev -> Asana) supports tasks, subtasks, comments (create-only), links, and attachments.

**Reference Material:**

- PRD: [docs/prd.md](../docs/prd.md)
- Asana API docs: https://developers.asana.com/reference/rest-api-reference
- Asana API Explorer: https://developers.asana.com/docs/api-explorer

**Sync unit:** An Asana Project (selected by the user from a workspace).

# 2. Technical Design

## 2.1 Authentication

Authentication is done via OAuth 2.0 (Authorization Code Grant) or Personal Access Token (PAT). Both are configured in `manifest.yaml`.

| Authentication | Type                     | Description                                                                                                                                                                              |
| :------------- | :----------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OAuth 2.0      | Authorization Code Grant | Authorize URL: `https://app.asana.com/-/oauth_authorize`, Token URL: `https://app.asana.com/-/oauth_token`. Refresh and revoke endpoints are configured. Scope: `default` (full access). |
| PAT            | Secret (Bearer token)    | Personal Access Token entered by the user. Verified via `GET /users/me`.                                                                                                                 |

Organization data (workspace) is resolved via `GET /workspaces` after authentication. For OAuth, the first workspace is selected (`.data[0]`). For PAT, all workspaces are available for selection (`.data[]`).

### 2.1.1 Permission and Visibility Behavior

Both OAuth tokens and PATs inherit the permissions of the **authorizing user**. The OAuth `default` scope grants the app permission to perform all API operations that the user can perform, but it does not elevate the user's access level within Asana. This means:

- A non-admin user will only see projects they are a member of. Private projects they have not been added to will not appear in the sync unit list.
- Guest users have even more restricted visibility — they may see zero projects by default.
- Workspace admins can see all projects in the workspace, including private ones.

**Recommendation:** Use a workspace admin account (or an [Asana Service Account](https://asana.com/guide/help/premium/service-accounts) on Enterprise plans) to authorize the connection. This ensures full project visibility across all projects in the workspace.

The connector performs a runtime check during ESU extraction by calling `GET /users/me/workspace_memberships` with `opt_fields=is_admin,is_guest`. If the authorizing user is not a workspace admin, a warning is logged indicating that some projects may not appear in the sync unit list. If the user is a guest, an additional warning is logged. This check is best-effort and does not block extraction if it fails.

## 2.2 Data Mapping

### 2.2.1 Record Type Mapping

| DevRev Object | Asana Object                    | Sync to DevRev | Sync to Asana | Notes                                                                                         |
| :------------ | :------------------------------ | :------------- | :------------ | :-------------------------------------------------------------------------------------------- |
| Issue (Work)  | Task                            | Yes            | Yes           | Primary work item. `ext_object_type` custom field set to "Task".                              |
| Issue (Work)  | Subtask                         | Yes            | Yes           | Child work item. `ext_object_type` custom field set to "Subtask". Create/update supported.    |
| Dev User      | User                            | Yes            | No            | Mapped by email. Read-only.                                                                   |
| Tag           | Tag                             | Yes            | No            | Workspace-level tags.                                                                         |
| Comment       | Comment (Story)                 | Yes            | Partial       | Asana stories. Create-only (Asana API does not support comment updates).                      |
| Attachment    | Attachment                      | Yes            | Yes           | Files extracted from task attachments. Loaded as external URL attachments.                    |
| Link          | Link (parent-child, dependency) | Yes            | Yes           | `is_parent_of` and `is_dependent_on` link types only. Other DevRev link types are not synced. |
| Group         | Team                            | Yes            | No            | Workspace teams extracted as DevRev groups. Forward-only.                                     |
| Object Member | Team Membership                 | Yes            | No            | One record per team with all member user GIDs. Forward-only.                                  |
| Access Rule   | Project Membership              | Yes            | No            | One access rule per distinct access level (admin, editor, commenter, viewer). Forward-only.   |

### 2.2.2 Task Field Mapping (tasks -> issue)

| DevRev Field              | Asana Field                        | Transformation                                       | Forward | Reverse |
| :------------------------ | :--------------------------------- | :--------------------------------------------------- | :------ | :------ |
| `title`                   | `name`                             | `use_directly`                                       | Yes     | Yes     |
| `body`                    | `description` (html_notes)         | `use_rich_text`                                      | Yes     | Yes     |
| `owned_by_ids`            | `assignee`                         | `use_as_array_value`                                 | Yes     | Yes     |
| `stage`                   | `section` (from memberships)       | `make_custom_stages` (dynamic from project sections) | Yes     | Yes     |
| `target_close_date`       | `due_date` (due_on / due_at)       | `use_directly`                                       | Yes     | Yes     |
| `target_start_date`       | `start_date` (start_on / start_at) | `use_directly`                                       | Yes     | Yes     |
| `created_by_id`           | `created_by`                       | `use_directly`                                       | Yes     | No      |
| `item_url_field`          | `permalink_url`                    | `use_directly`                                       | Yes     | No      |
| `priority`                | --                                 | `use_fixed_value` (P2)                               | Yes     | No      |
| `reported_by_ids`         | `followers`                        | `use_directly`                                       | Yes     | No      |
| `tags`                    | `tags`                             | `use_directly`                                       | Yes     | Yes     |
| `actual_close_date`       | `completed_at`                     | `use_directly`                                       | Yes     | No      |
| `applies_to_part_id`      | --                                 | `use_devrev_record` (product)                        | Yes     | No      |
| `completed`               | `completed`                        | (metadata only, bool)                                | Yes     | No      |
| `completed_by`            | `completed_by`                     | (metadata only, user ref)                            | Yes     | No      |
| `reported_by`             | `created_by`                       | (metadata only, user ref)                            | Yes     | No      |
| `actual_effort`           | `actual_time_minutes`              | (metadata only, float)                               | Yes     | No      |
| `resource_subtype`        | `resource_subtype`                 | (metadata only, enum)                                | Yes     | No      |
| `parent_task`             | `parent`                           | (metadata only, task ref)                            | Yes     | No      |
| Custom: `ext_object_type` | --                                 | `use_raw_jq` ("Task")                                | Yes     | No      |
| Custom fields             | `custom_fields`                    | Dynamic mapping by GID                               | Yes     | Yes     |

> **Note:** Fields marked "(metadata only)" are defined in `external_domain_metadata.json` and extracted into normalized data but do not have explicit entries in `initial_domain_mapping.json`. They are available for platform-level mapping. Bidirectional fields (`title`, `body`, `owned_by_ids`, `stage`, `target_close_date`, `target_start_date`, `tags`, custom fields) are configured in `initial_domain_mapping.json`.

### 2.2.3 Subtask Field Mapping (subtasks -> issue)

| DevRev Field              | Asana Field                        | Transformation                | Forward | Reverse |
| :------------------------ | :--------------------------------- | :---------------------------- | :------ | :------ |
| `title`                   | `name`                             | `use_directly`                | Yes     | Yes     |
| `body`                    | `description` (html_notes)         | `use_rich_text`               | Yes     | Yes     |
| `owned_by_ids`            | `assignee`                         | `use_as_array_value`          | Yes     | Yes     |
| `stage`                   | `completed_stage` (open/completed) | `make_custom_stages`          | Yes     | Yes     |
| `target_close_date`       | `due_date`                         | `use_directly`                | Yes     | Yes     |
| `target_start_date`       | `start_date`                       | `use_directly`                | Yes     | Yes     |
| `created_by_id`           | `created_by`                       | `use_directly`                | Yes     | No      |
| `item_url_field`          | `permalink_url`                    | `use_directly`                | Yes     | No      |
| `priority`                | --                                 | `use_fixed_value` (P2)        | Yes     | No      |
| `reported_by_ids`         | `followers`                        | `use_directly`                | Yes     | No      |
| `tags`                    | `tags`                             | `use_directly`                | Yes     | Yes     |
| `actual_close_date`       | `completed_at`                     | `use_directly`                | Yes     | No      |
| `applies_to_part_id`      | --                                 | `use_devrev_record` (product) | Yes     | No      |
| `completed`               | `completed`                        | (metadata only, bool)         | Yes     | No      |
| `completed_by`            | `completed_by`                     | (metadata only, user ref)     | Yes     | No      |
| `reported_by`             | `created_by`                       | (metadata only, user ref)     | Yes     | No      |
| `actual_effort`           | `actual_time_minutes`              | (metadata only, float)        | Yes     | No      |
| `resource_subtype`        | `resource_subtype`                 | (metadata only, enum)         | Yes     | No      |
| `parent_task`             | `parent`                           | (metadata only, task ref)     | Yes     | No      |
| Custom: `ext_object_type` | --                                 | `use_raw_jq` ("Subtask")      | Yes     | No      |
| Custom fields             | `custom_fields`                    | Dynamic mapping by GID        | Yes     | Yes     |

> **Note:** Subtask create uses `POST /tasks/{parentGid}/subtasks`, update uses `PUT /tasks/{subtaskGid}`. Parent is resolved via mapper service. Tags are applied individually after creation.

### 2.2.4 User Field Mapping (users -> devu)

| DevRev Field   | Asana Field | Transformation | Forward | Reverse |
| :------------- | :---------- | :------------- | :------ | :------ |
| `display_name` | `name`      | `use_directly` | Yes     | No      |
| `email`        | `email`     | `use_directly` | Yes     | No      |
| `full_name`    | `name`      | `use_directly` | Yes     | No      |

Users are read-only (no reverse sync).

### 2.2.5 Tag Field Mapping (tags -> tag)

| DevRev Field  | Asana Field | Transformation | Forward | Reverse |
| :------------ | :---------- | :------------- | :------ | :------ |
| `name`        | `name`      | `use_directly` | Yes     | No      |
| `color`       | `color`     | (metadata only)| Yes     | No      |
| `description` | `notes`     | (metadata only)| Yes     | No      |

Tags are forward-only. Only `name` is mapped in `initial_domain_mapping.json`; `color` and `description` are extracted into metadata.

### 2.2.6 Comment Field Mapping (comments -> comment)

| DevRev Field       | Asana Field            | Transformation  | Forward | Reverse |
| :----------------- | :--------------------- | :-------------- | :------ | :------ |
| `body`             | `html_text` / `text`   | `use_rich_text` | Yes     | Yes     |
| `parent_object_id` | `parent_id` (task GID) | `use_directly`  | Yes     | Yes     |
| `created_by_id`    | `created_by`           | `use_directly`  | Yes     | No      |
| `modified_by_id`   | `created_by`           | `use_directly`  | Yes     | No      |

> **Note:** Comment create uses `POST /tasks/{taskGid}/stories`. Updates return an error because Asana API does not support updating or deleting comments (stories).

### 2.2.7 Link Field Mapping (links -> link)

| DevRev Field | Asana Field                 | Transformation                                 | Forward | Reverse |
| :----------- | :-------------------------- | :--------------------------------------------- | :------ | :------ |
| `link_type`  | `link_type`                 | `map_enum` (`is_parent_of`, `is_dependent_on`) | Yes     | Yes     |
| `source_id`  | `source` (task/subtask GID) | `use_directly`                                 | Yes     | Yes     |
| `target_id`  | `target` (task/subtask GID) | `use_directly`                                 | Yes     | Yes     |

> **Note:** `is_dependent_on` links use `POST /tasks/{taskGid}/addDependencies`, `is_parent_of` links use `POST /tasks/{taskGid}/setParent`. Other DevRev link types (`is_duplicate_of`, `is_related_to`) are skipped with a warning as Asana has no equivalent.

### 2.2.8 Group Field Mapping (teams -> group)

| DevRev Field  | Asana Field   | Transformation  | Forward | Reverse |
| :------------ | :------------ | :-------------- | :------ | :------ |
| `name`        | `name`        | `use_directly`  | Yes     | No      |
| `description` | `description` | `use_rich_text` | Yes     | No      |
| `member_type` | --            | `use_fixed_value` (`dev_user`) | Yes | No |

Groups (teams) are forward-only (no reverse sync).

### 2.2.9 Group Membership Field Mapping (team_memberships -> object_member)

| DevRev Field         | Asana Field        | Transformation   | Forward | Reverse |
| :------------------- | :----------------- | :--------------- | :------ | :------ |
| `object_id`          | `group_id`         | `use_directly`   | Yes     | No      |
| `add_member_ids`     | `member_ids`       | `use_directly`   | Yes     | No      |
| `target_object_type` | --                 | `use_fixed_value` (`group`) | Yes | No |

Group memberships are forward-only.

### 2.2.10 Access Rule Field Mapping (project_memberships -> unified_authorization_policy)

| DevRev Field       | Asana Field        | Transformation       | Forward | Reverse |
| :----------------- | :----------------- | :------------------- | :------ | :------ |
| `users`            | `permission_users` | `use_directly`       | Yes     | No      |
| `groups`           | `permission_groups`| `use_directly`       | Yes     | No      |
| `object_access`    | `object_access`    | `make_object_access` | Yes     | No      |

Access rules are derived from Asana project memberships. Each distinct access level (`admin`, `editor`, `commenter`, `viewer`) produces a separate access rule record. Commenter access is split into two rules: one for tasks/subtasks (read-only) and one for comments (create + read). For `public_to_workspace` projects, all workspace users are added as viewers.

## 2.3 Endpoints

### 2.3.1 Extraction Endpoints (Asana -> DevRev)

Base URL: `https://app.asana.com/api/1.0`

| Object         | Method | Endpoint                                  | Purpose                                              |
| :------------- | :----- | :---------------------------------------- | :--------------------------------------------------- |
| Projects (ESU) | GET    | `/workspaces/{workspaceId}/projects`      | List projects for sync unit selection                |
| Task Count     | GET    | `/projects/{projectId}/task_counts`       | Get task count for progress reporting                |
| Tasks          | GET    | `/projects/{projectId}/tasks`             | List tasks with all fields (opt_fields)              |
| Subtasks       | GET    | `/tasks/{taskGid}/subtasks`               | List subtasks for a task (recursive, up to 2 levels) |
| Users          | GET    | `/users?workspace={workspaceId}`          | List users in workspace                              |
| Tags           | GET    | `/workspaces/{workspaceId}/tags`          | List tags in workspace                               |
| Custom Fields  | GET    | `/projects/{projectId}/custom_field_settings` | List custom field settings for the project           |
| Comments       | GET    | `/tasks/{taskGid}/stories`                | List stories/comments for a task                     |
| Sections       | GET    | `/projects/{projectId}/sections`          | List sections for stage mapping                      |
| Teams          | GET    | `/workspaces/{workspaceId}/teams`         | List teams for group extraction                                     |
| Team Members   | GET    | `/teams/{teamGid}/team_memberships`       | List team members for group membership                              |
| Project Memberships | GET | `/memberships?parent={projectId}`       | List project memberships for access rules                           |
| Project        | GET    | `/projects/{projectId}`                   | Get project privacy setting for access rules                        |
| Workspace Membership | GET | `/users/me/workspace_memberships`    | Check if authorizing user is workspace admin         |

All extraction endpoints use offset-based pagination with `limit=100` and `opt_fields` to request specific fields.

For time-scoped and incremental syncs, tasks are filtered using the `modified_since` API parameter (lower bound from `extract_from`) and client-side filtering (upper bound from `extract_to`). Subtasks, comments, and attachments are filtered client-side on both bounds.

### 2.3.2 Loading Endpoints (DevRev -> Asana)

| Object                 | Method | Endpoint                              | Purpose                        | Status              |
| :--------------------- | :----- | :------------------------------------ | :----------------------------- | :------------------ |
| Task (create)          | POST   | `/tasks`                              | Create a new task              | Implemented |
| Task (update)          | PUT    | `/tasks/{taskGid}`                    | Update an existing task        | Implemented |
| Attachment             | POST   | `/attachments`                        | Create external URL attachment | Implemented |
| Subtask (create)       | POST   | `/tasks/{parentGid}/subtasks`         | Create subtask for a task      | Implemented |
| Comment (create)       | POST   | `/tasks/{taskGid}/stories`            | Create comment on a task       | Implemented |
| Dependency (add)       | POST   | `/tasks/{taskGid}/addDependencies`    | Add dependency link            | Implemented |
| Dependency (remove)    | POST   | `/tasks/{taskGid}/removeDependencies` | Remove dependency link         | Implemented |
| Parent (set)           | POST   | `/tasks/{taskGid}/setParent`          | Set parent for subtask         | Implemented |
| Section (add task)     | POST   | `/sections/{sectionGid}/addTask`      | Move task to section/stage     | Implemented |
| Tag (add to task)      | POST   | `/tasks/{taskGid}/addTag`             | Add tag to task                | Implemented |
| Tag (remove from task) | POST   | `/tasks/{taskGid}/removeTag`          | Remove tag from task           | Implemented |

> **Note:** All loading endpoints are implemented in `load-data.ts` and `load-attachments.ts`.

## 2.4 Source System Analysis and Constraints

### 2.4.1 Rate Limiting

| Limit               | Value                 | Description                                     |
| :------------------ | :-------------------- | :---------------------------------------------- |
| Requests per minute | 1,500                 | Applies to all API tiers (Standard and Premium) |
| Response code       | 429 Too Many Requests | Returned when rate limit is exceeded            |
| Retry strategy      | `Retry-After` header  | Exponential backoff with `Retry-After` value    |

The `AsanaClient` uses `axios-retry` with exponential backoff (1s, 2s, 4s) for 5xx errors and network errors. 429 responses are handled at the worker level by reading the `Retry-After` header and returning a delay for framework retry.

### 2.4.2 Pagination

| Type      | Description                                                               |
| :-------- | :------------------------------------------------------------------------ |
| Style     | Offset-based                                                              |
| Page size | 100 items per page (tasks, users, tags, custom fields, stories, sections) |
| Mechanism | Response includes `next_page.offset`; pass as `offset` query parameter    |

### 2.4.3 Response Format

| Property    | Value            |
| :---------- | :--------------- |
| Format      | application/json |
| Charset     | UTF-8            |
| API Version | Asana API v1.0   |

### 2.4.4 Response Codes

| Code | Description           | Handling                                     |
| :--- | :-------------------- | :------------------------------------------- |
| 200  | Success               | Process response                             |
| 201  | Created               | Process response (loading)                   |
| 400  | Bad Request           | Log and report error                         |
| 401  | Unauthorized          | Token expired or invalid; re-authenticate    |
| 403  | Forbidden             | Insufficient permissions; log and skip       |
| 404  | Not Found             | Object deleted or inaccessible; log and skip |
| 429  | Too Many Requests     | Wait for `Retry-After` duration, then retry  |
| 500  | Internal Server Error | Retry with exponential backoff               |

## 2.5 Metadata Extraction

During the metadata extraction phase, the connector:

1. Fetches **custom fields** for the project via `/projects/{projectId}/custom_field_settings`. Each custom field is mapped to a DevRev field definition based on its type:
   - `text` -> text
   - `number` -> float
   - `enum` -> enum (with allowed values from `enum_options`)
   - `multi_enum` -> enum with collection (with allowed values)
   - `date` -> timestamp
   - `people` -> reference (user reference with collection)
   - `formula` -> text (read-only; computed `display_value` is extracted)
   
   Custom field definitions are added to both the **task** and **subtask** record type schemas.

2. Fetches **sections** for the project via `/projects/{projectId}/sections`. Sections are mapped to DevRev stage diagrams:
   - First section -> `open` state
   - Middle sections -> `in_progress` state
   - Last section -> `closed` state
   - All transitions between stages are allowed (`all_transitions_allowed: true`)

3. For subtasks, a simplified stage diagram is generated:
   - `open` (not completed) — maps to state `open`
   - `completed` (completed) — maps to state `closed` (with `is_end_state: true`)

## 2.6 Data Extraction Architecture

Data extraction (`data-extraction.ts`) uses a **buffer-and-flush** pattern to ensure timeout safety:

1. For each task page, the worker iterates through tasks one at a time.
2. Each task's sub-objects (subtasks, comments, attachments, links) are collected into a `TaskExtractionBuffer` object.
3. Only after the entire task tree (including recursive subtasks) is fully processed, the buffer is flushed atomically to repos.
4. Timeout is checked after each task flush — if the worker times out mid-task, no partial data is pushed, preventing duplicates on resume.
5. On resume (`CONTINUE_EXTRACTING_DATA`), extraction starts from `lastExtractedTaskIndex + 1` on the current page.

**Comment filtering:** During extraction, comments are filtered to exclude:
- Attachment-only comments (comments containing only an asset URL with no text content)
- Comments with mixed content where stripping asset URLs leaves no remaining text
- Image-only comments are kept (they reference inline images)

**Time-scoped extraction:** The platform provides `extract_from` and `extract_to` on `adapter.event.payload.event_context`. Tasks use `extract_from` as the Asana API's `modified_since` parameter (lower bound); `extract_to` is applied client-side (upper bound) since Asana has no `modified_before` parameter. Subtasks are filtered by `created_at` and `modified_at` against both bounds. Comments and attachments are filtered by `created_at` against both bounds. The `prepareStateForExtraction` function resets entity progress on incremental syncs; time bounds are read directly from the event (not stored in state).

## 2.7 Attachments Handling

Attachments are extracted from task properties during data extraction. Each task includes an `attachments` array with `download_url` and `name` (requested via opt_fields). The normalized attachment contains: `id` (GID), `url` (download_url), `file_name` (name), `parent_id`, and `inline` flag.

**Inline attachments:** The connector identifies inline images by scanning `html_notes` (task descriptions) and `html_text` (comments) for `<img>` tags with `data-asana-type="attachment"`. These are marked with `inline: true`. Comment-attached images are mapped to their parent comment GID rather than the task GID.

**Forward (extraction):** Attachments are streamed to DevRev using the `download_url` from Asana. Batch size is 50 attachments per batch. During time-scoped or incremental sync, attachments are filtered by `created_at` against both `extract_from` (lower bound) and `extract_to` (upper bound).

**Reverse (loading):** Attachments are downloaded from DevRev artifact URLs and uploaded to Asana as file attachments via `POST /attachments` (multipart form upload) using `createTaskAttachment`. The parent task is resolved via the mapper service.

## 2.8 Rich Text Handling

Asana provides task descriptions and comments as HTML (`html_notes`, `html_text`). The connector parses this HTML into DevRev's AirSync rich text format:

- Inline attachment `<img>` tags (`data-asana-type="attachment"`) are stripped before processing to prevent duplication with extracted attachments
- `<br>` tags are converted to newlines, `</p>` tags to double newlines, and remaining HTML tags are stripped
- HTML entities are decoded (`&amp;`, `&lt;`, `&gt;`, `&quot;`, `&#39;`, `&nbsp;`)
- Asana mentions (`<a data-asana-gid="..." data-asana-type="user">@name</a>`) are converted to AirSync mention objects with external user references

**Reverse (loading):** Rich text from DevRev is converted to Asana HTML via `serializeToAsanaHtml` in `rich-text-serializer.ts`. Text is HTML-escaped and newlines are converted to `<br>` tags. Mentions are rendered as `<a data-asana-gid="..." data-asana-type="user">` tags. The output is wrapped in a `<body>` element. Plain text extraction is also available via `serializeToPlainText`.

# 3. Limitations

1. **Comment updates:** Asana API does not support updating or deleting comments (stories). Reverse sync for comments is create-only; update requests are silently treated as no-ops (return success without action).
2. **Subtask depth:** Subtask extraction is limited to 2 levels of nesting (subtask and sub-subtask, i.e. `MAX_SUBTASK_DEPTH = 2` where 0 = project task, 1 = subtask, 2 = sub-subtask). This is a DevRev platform limitation: links only support 2 levels deep.
3. **Multi-homing:** Asana tasks can belong to multiple projects. The connector syncs tasks from the selected project only; section/stage is derived from the membership in the current project context.
4. **Guest access:** Guests in Asana have zero visibility by default. The connector only syncs objects accessible to the authenticated user.
5. **Custom field types:** The `formula` custom field type is mapped as `text` and its computed `display_value` is extracted. Full formula semantics are not preserved.
6. **Priority mapping:** Asana does not have a native priority field. All tasks are assigned a fixed priority of P2 in DevRev.
7. **User creation:** Users are forward-only (Asana -> DevRev). New DevRev users cannot be created in Asana.
8. **Tag record creation:** Tag records are forward-only (Asana -> DevRev). New tags cannot be created in Asana from DevRev. However, tag assignments to tasks are bidirectional.
9. **Project not synced as record:** Asana Projects are used as external sync unit selectors but are not synced as DevRev Enhancement/Part records. Project metadata (name, description, owner, dates) is not imported.
10. **Project visibility is user-scoped:** The connector can only see and sync projects that the authorizing user has access to. If a non-admin user authorizes the connection, private projects they are not a member of will not appear in the sync unit list. A runtime warning is logged when this is detected during ESU extraction.
11. **Groups/Teams are forward-only:** Teams are extracted as groups with their memberships. Reverse sync (creating teams in Asana from DevRev) is not supported.
12. **Access rules are forward-only:** Project membership permissions are extracted as access rules per access level. Reverse sync (setting permissions in Asana from DevRev) is not supported.


# 4. Loading Implementation

Loading (DevRev -> Asana) is implemented for tasks, subtasks, comments, links, and attachments.

### Record Types

| Record Type | Create | Update | Notes                                                                                                         |
| :---------- | :----- | :----- | :------------------------------------------------------------------------------------------------------------ |
| Task        | Yes    | Yes    | Fields: name, assignee, html_notes, due_on, start_on, completed. Section and tags applied after create/update. |
| Subtask     | Yes    | Yes    | Same fields as task. Created via `POST /tasks/{parentGid}/subtasks`. Parent resolved via mapper service.       |
| Comment     | Yes    | No-op  | Create via `POST /tasks/{taskGid}/stories`. Updates return error (Asana API limitation).                       |
| Link        | Yes    | Yes    | `is_dependent_on` via `addDependencies`, `is_parent_of` via `setParent`. `is_duplicate_of`/`is_related_to` skipped. |
| Attachment  | Yes    | N/A    | Downloaded from DevRev artifact URL and uploaded as file attachment via multipart form.                        |

### Files Involved in Loading

| File                                                     | Purpose                                                              |
| :------------------------------------------------------- | :------------------------------------------------------------------- |
| `code/src/asana/data-denormalization.ts`                 | `denormalizeTask`, `denormalizeComment`, `denormalizeLink` — converts DevRev data to Asana API format |
| `code/src/utils/rich-text-helpers.ts`                    | `serializeToAsanaHtml`, `serializeToPlainText` — rich text to Asana HTML |
| `code/src/utils/loading-helpers.ts`                      | `handleLoadingError` (429 → delay), `resolveExternalId` (DevRev ID → Asana GID via mappers), `resolveRef` (reference object → Asana GID), `extractExternalIdFromRef` (extract external ID from SDK reference objects) |
| `code/src/utils/field-extraction-helpers.ts`             | `toTimestamp`, `toDateOnly`, `extractCustomFields`, `extractSectionFromMemberships` — pure data transformation utilities |
| `code/src/utils/permissions-helpers.ts`                  | `extractPermissions` — fetches project memberships, groups by access level, produces access rule records. Groups and group memberships completed state is also set here. |
| `code/src/functions/loading/index.ts`                    | Loading orchestrator — defines `LoaderState`, calls `spawn()`        |
| `code/src/functions/loading/workers/load-data.ts`        | Task, subtask, comment, and link create/update via `adapter.loadItemTypes()` |
| `code/src/functions/loading/workers/load-attachments.ts` | Attachment download and upload via `adapter.loadAttachments()`       |
| `code/src/asana/api-client/index.ts`                     | Write methods: `createTask`, `updateTask`, `createTaskSubtask`, `createTaskComment`, `addTaskDependencies`, `setTaskParent`, `addTaskToSection`, `addTagToTask`, `removeTagFromTask`, `createTaskAttachment` |

### Partial Failure Handling

Section assignment and tag application are performed after the primary task/subtask create/update. If these secondary operations fail, the task is still reported as successfully created/updated, but a warning is logged with the task GID and DevRev ID for traceability. This prevents a tag assignment failure from blocking the entire task creation.

### Comment Update No-op

The `updateComment` handler returns success (`{}`) without performing any action, because Asana's API does not support updating or deleting stories. This is intentional — the task still appears as successfully loaded.
