# Asana Snap-in

## What it Does

Asana snap-in acts as a connector between Asana and DevRev. It was created as an example of a functional snap-in and is designed to help developers create their own snap-ins or extend the existing one.

It enables a forward sync, where it extracts tasks, task attachments, and users from Asana and imports them into DevRev. Additionally, it supports incremental and reverse sync, allowing the extraction of issues and attachments from DevRev to be imported into Asana.

### Mapping Details

- Asana project is used as an external sync unit for DevRev.
- Asana tasks map to DevRev issues:
  - The task `name` becomes the issue `title`.
  - Task `html_notes` are transformed into the issue `body`.
  - Task `assignee` is mapped to both `created_by` and `owned_by` in DevRev.
  - Task `created_at` is mapped to `created_date`.
  - Task `modified_at` is mapped to `modified_date`.
- Users in both systems are identified by a `name` and `email`.

### Current Limitations

- `priority` and `stage` are required fields for an issue object in DevRev. Asana tasks by default do not have these kind of fields, but they can be added as custom fields.
- Extraction of Asana custom fields is currently not supported since custom field usage requires a payable Asana account.
- By default, all issues created in DevRev from Asana tasks have a priority value of "P0" and start in the "Backlog" stage.

### Further Development

- Developers can find instructions for further snap-in development in the [DevRev documentation](https://developer.devrev.ai/public/snapin-development/adaas/overview).

## Create an Account in Asana

- You can create a new Asana account [here](https://asana.com/create-account).
- A basic account is available for free.
- To connect with the Asana snap-in, you will need to provide an Asana Personal Access Token (PAT).
  - [Instructions to obtain a PAT token](https://developers.asana.com/docs/personal-access-token).
- This snap-in utilizes the Asana API. You can access the Asana API documentation [here](https://developers.asana.com/reference/rest-api-reference).
