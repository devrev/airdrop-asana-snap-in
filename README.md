# Asana Snap-in

## What it Does

- The Asana snap-in serves as a connector between Asana and DevRev.
- Created as an example of a working snap-in, it aims to assist developers in building their own snap-ins or extending this one.

Asana snap-in allows running a _forward sync_ (Asana -> DevRev):

- It can extract tasks, task attachments, and users from Asana and import them into DevRev.

And a _reverse sync_:

- It can extract issues and issue attachments from DevRev and import them into Asana.

This snap-in also supports running incremental syncs and handling Asana API rate limits.

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
