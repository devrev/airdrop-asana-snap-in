import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

import {
  AsanaMockClient,
  AsanaUser,
  AsanaProject,
  AsanaSection,
  AsanaTag,
  AsanaResource,
  AsanaTaskResponse,
} from './asana-mock-client';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const MANIFEST_PATH = path.resolve(__dirname, 'mock-data-manifest.json');

// ─── Manifest types ──────────────────────────────────────────────

interface Manifest {
  createdAt: string;
  workspaceId: string;
  users: AsanaUser[];
  teams: AsanaResource[];
  tags: { gid: string; name: string }[];
  customFields: { gid: string; name: string }[];
  projects: {
    gid: string;
    name: string;
    privacy: string;
    sections: { gid: string; name: string }[];
  }[];
  tasks: { gid: string; name: string; projectGid: string }[];
  subtasks: { gid: string; name: string; parentGid: string }[];
  comments: { gid: string; taskGid: string }[];
  attachments: { gid: string; taskGid: string; name: string }[];
  dependencies: { taskGid: string; dependsOnGid: string }[];
}

// ─── Helpers ─────────────────────────────────────────────────────

function futureDate(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().split('T')[0];
}

function pastDate(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split('T')[0];
}

function log(emoji: string, msg: string) {
  console.log(`${emoji}  ${msg}`);
}

// ─── Fake file generators ─────────────────────────────────────────

function generateTxtFile(label: string): Buffer {
  return Buffer.from(
    `AirSync Test Document — ${label}\n` +
    `Generated: ${new Date().toISOString()}\n\n` +
    `This is a plain-text test file for validating attachment extraction.\n` +
    `It contains multiple lines to simulate realistic content.\n\n` +
    `Section 1: Overview\n` +
    `  The quick brown fox jumps over the lazy dog.\n\n` +
    `Section 2: Details\n` +
    `  Lorem ipsum dolor sit amet, consectetur adipiscing elit.\n` +
    `  Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.\n`,
    'utf-8'
  );
}

function generateCsvFile(): Buffer {
  const rows = [
    'id,name,email,role,status',
    '1,Alice Johnson,alice@example.com,Engineer,Active',
    '2,Bob Smith,bob@example.com,Designer,Active',
    '3,Carol Williams,carol@example.com,PM,On Leave',
    '4,David Brown,david@example.com,QA,Active',
    '5,Eve Davis,eve@example.com,DevOps,Inactive',
  ];
  return Buffer.from(rows.join('\n') + '\n', 'utf-8');
}

function generateJsonFile(): Buffer {
  const config = {
    version: '1.0.0',
    environment: 'test',
    features: {
      auth: { enabled: true, provider: 'oauth2' },
      sync: { interval_minutes: 15, max_retries: 3 },
      notifications: { email: true, slack: false },
    },
    endpoints: [
      { name: 'users', path: '/api/v1/users', method: 'GET' },
      { name: 'tasks', path: '/api/v1/tasks', method: 'GET' },
    ],
  };
  return Buffer.from(JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

function generateMdFile(): Buffer {
  return Buffer.from(
    '# Meeting Notes — Sprint Planning\n\n' +
    '**Date:** 2026-03-15  \n' +
    '**Attendees:** Alice, Bob, Carol\n\n' +
    '## Agenda\n\n' +
    '1. Review previous sprint\n' +
    '2. Prioritize backlog items\n' +
    '3. Assign capacity\n\n' +
    '## Action Items\n\n' +
    '- [ ] Alice: finalize API design by Wed\n' +
    '- [ ] Bob: update wireframes\n' +
    '- [x] Carol: create project board\n\n' +
    '## Notes\n\n' +
    '> We agreed to focus on the auth module first.\n',
    'utf-8'
  );
}

function generateMinimalPng(): Buffer {
  // 1×1 red pixel PNG — smallest valid PNG file
  return Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR length + type
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1×1
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, // 8-bit RGB + CRC
    0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, // IDAT length + type
    0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00, 0x00, // compressed data
    0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc, 0x33, // CRC
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, // IEND length + type
    0xae, 0x42, 0x60, 0x82,                           // CRC
  ]);
}

interface FakeFile {
  name: string;
  buffer: Buffer;
  contentType: string;
}

function generateFakeFiles(): FakeFile[] {
  return [
    { name: 'requirements.txt', buffer: generateTxtFile('Requirements'), contentType: 'text/plain' },
    { name: 'team-roster.csv', buffer: generateCsvFile(), contentType: 'text/csv' },
    { name: 'app-config.json', buffer: generateJsonFile(), contentType: 'application/json' },
    { name: 'sprint-notes.md', buffer: generateMdFile(), contentType: 'text/markdown' },
    { name: 'screenshot.png', buffer: generateMinimalPng(), contentType: 'image/png' },
    { name: 'test-data.txt', buffer: generateTxtFile('Test Data'), contentType: 'text/plain' },
    { name: 'schema-draft.json', buffer: generateJsonFile(), contentType: 'application/json' },
  ];
}

function loadManifest(): Manifest | null {
  if (fs.existsSync(MANIFEST_PATH)) {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
  }
  return null;
}

function saveManifest(manifest: Manifest) {
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
}

// ─── Cleanup ─────────────────────────────────────────────────────

async function cleanup(client: AsanaMockClient) {
  const manifest = loadManifest();
  if (!manifest) {
    console.log('No manifest found. Nothing to clean up.');
    return;
  }

  log('🗑️', `Cleaning up resources created at ${manifest.createdAt}`);

  // Delete in reverse dependency order: projects cascade-delete their tasks/sections
  for (const cf of manifest.customFields) {
    try {
      await client.deleteCustomField(cf.gid);
      log('  ✓', `Deleted custom field: ${cf.name} (${cf.gid})`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      log('  ✗', `Failed to delete custom field ${cf.name}: ${msg}`);
    }
  }

  for (const tag of manifest.tags) {
    try {
      await client.deleteTag(tag.gid);
      log('  ✓', `Deleted tag: ${tag.name} (${tag.gid})`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      log('  ✗', `Failed to delete tag ${tag.name}: ${msg}`);
    }
  }

  for (const project of manifest.projects) {
    try {
      await client.deleteProject(project.gid);
      log('  ✓', `Deleted project: ${project.name} (${project.gid})`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      log('  ✗', `Failed to delete project ${project.name}: ${msg}`);
    }
  }

  fs.unlinkSync(MANIFEST_PATH);
  log('✅', 'Cleanup complete. Manifest deleted.');
}

// ─── Main generation logic ───────────────────────────────────────

async function generate(client: AsanaMockClient) {
  const existing = loadManifest();
  if (existing) {
    console.log(
      `A manifest already exists (created ${existing.createdAt}). ` +
        `Run with --cleanup first, or delete ${MANIFEST_PATH} manually.`
    );
    process.exit(1);
  }

  const manifest: Manifest = {
    createdAt: new Date().toISOString(),
    workspaceId: '',
    users: [],
    teams: [],
    tags: [],
    customFields: [],
    projects: [],
    tasks: [],
    subtasks: [],
    comments: [],
    attachments: [],
    dependencies: [],
  };

  // Save manifest on error so cleanup can remove partial resources
  const saveOnError = () => {
    if (manifest.projects.length > 0 || manifest.tags.length > 0 || manifest.customFields.length > 0) {
      saveManifest(manifest);
      log('💾', `Partial manifest saved. Run --cleanup to remove created resources.`);
    }
  };
  process.on('uncaughtException', saveOnError);
  process.on('unhandledRejection', saveOnError);

  try {
  // ── 1. Discover workspace ─────────────────────────────────────
  log('🔍', 'Discovering workspaces...');
  const workspaces = await client.getWorkspaces();
  const wsId = process.env.ASANA_WORKSPACE_ID || workspaces[0]?.gid;
  if (!wsId) {
    throw new Error('No workspace found. Set ASANA_WORKSPACE_ID in .env');
  }
  const ws = workspaces.find((w) => w.gid === wsId) || workspaces[0];
  manifest.workspaceId = wsId;
  log('  ✓', `Workspace: ${ws.name} (${wsId})`);

  // ── 2. Discover users ─────────────────────────────────────────
  log('👤', 'Fetching users...');
  const users = await client.getUsers(wsId);
  manifest.users = users;
  for (const u of users) {
    log('  ✓', `User: ${u.name} <${u.email}> (${u.gid})`);
  }

  const adminUser = users.find((u) => u.email === 'radovan.jorgic@devrev.ai');
  const guestUser = users.find((u) => u.email === 'raddyjork@gmail.com');
  if (!adminUser) throw new Error('Admin user radovan.jorgic@devrev.ai not found');
  log('  →', `Admin: ${adminUser.name} (${adminUser.gid})`);
  if (guestUser) {
    log('  →', `Guest: ${guestUser.name} (${guestUser.gid})`);
  } else {
    log('  ⚠', 'Guest user raddyjork@gmail.com not found. Permission scenarios will be limited.');
  }

  // ── 3. Discover teams ─────────────────────────────────────────
  log('👥', 'Fetching teams...');
  const teams = await client.getTeams(wsId);
  manifest.teams = teams;
  for (const t of teams) {
    log('  ✓', `Team: ${t.name} (${t.gid})`);
  }

  // Prefer ASANA_TEAM_ID from env, then try known team names, then fall back
  const teamId = process.env.ASANA_TEAM_ID;
  let defaultTeam = teamId ? teams.find((t) => t.gid === teamId) : undefined;
  if (!defaultTeam) {
    const candidates = teams.filter((t) => t.name?.includes("Radovan's first team"));
    if (candidates.length > 1 && adminUser) {
      // Pick the team whose GID prefix is closest to the admin user's GID prefix
      // (auto-created teams have GIDs near the user's GID)
      const userPrefix = adminUser.gid.slice(0, 6);
      candidates.sort(
        (a, b) =>
          Math.abs(parseInt(a.gid.slice(0, 6)) - parseInt(userPrefix)) -
          Math.abs(parseInt(b.gid.slice(0, 6)) - parseInt(userPrefix))
      );
      defaultTeam = candidates[0];
    } else {
      defaultTeam = candidates[0] || teams.find((t) => t.name === 'AirSync') || teams[0];
    }
  }
  if (!defaultTeam) throw new Error('No team found in workspace. Set ASANA_TEAM_ID in .env');
  log('  →', `Using team: ${defaultTeam.name} (${defaultTeam.gid})`);

  // ── 4. Create tags ────────────────────────────────────────────
  log('🏷️', 'Creating tags...');
  const tagDefs = [
    { name: 'airsync-bug', color: 'light-red' },
    { name: 'airsync-feature', color: 'light-blue' },
    { name: 'airsync-enhancement', color: 'light-green' },
  ];
  const tags: (AsanaTag & { name: string })[] = [];
  for (const td of tagDefs) {
    const tag = await client.createTag(wsId, td.name, td.color);
    tags.push({ ...tag, name: td.name });
    manifest.tags.push({ gid: tag.gid, name: td.name });
    log('  ✓', `Tag: ${td.name} (${tag.gid})`);
  }

  // ── 5. Create custom fields (different sets per project) ──────
  log('📋', 'Setting up custom fields...');

  // Field definitions — each will be selectively added to projects
  const cfDefs: {
    key: string;
    name: string;
    resource_subtype: 'text' | 'number' | 'enum' | 'multi_enum';
    enum_options?: { name: string; color?: string }[];
    precision?: number;
    projects: number[]; // indices into projectConfigs (0=public, 1=private, 2=shared)
  }[] = [
    {
      key: 'priorityNote',
      name: 'AirSync Priority Note',
      resource_subtype: 'text',
      projects: [0, 2],  // public + shared
    },
    {
      key: 'status',
      name: 'AirSync Status',
      resource_subtype: 'enum',
      enum_options: [
        { name: 'Not Started', color: 'red' },
        { name: 'In Progress', color: 'yellow-orange' },
        { name: 'Blocked', color: 'hot-pink' },
      ],
      projects: [0],  // public only
    },
    {
      key: 'estimate',
      name: 'AirSync Estimate',
      resource_subtype: 'number',
      precision: 0,
      projects: [0],  // public only
    },
    {
      key: 'severity',
      name: 'AirSync Severity',
      resource_subtype: 'enum',
      enum_options: [
        { name: 'Low', color: 'green' },
        { name: 'Medium', color: 'yellow-orange' },
        { name: 'High', color: 'orange' },
        { name: 'Critical', color: 'red' },
      ],
      projects: [1],  // private only
    },
    {
      key: 'sprint',
      name: 'AirSync Sprint',
      resource_subtype: 'enum',
      enum_options: [
        { name: 'Sprint 1', color: 'light-blue' },
        { name: 'Sprint 2', color: 'light-purple' },
        { name: 'Sprint 3', color: 'light-pink' },
      ],
      projects: [2],  // shared only
    },
    {
      key: 'labels',
      name: 'AirSync Labels',
      resource_subtype: 'multi_enum',
      enum_options: [
        { name: 'Frontend', color: 'light-blue' },
        { name: 'Backend', color: 'light-green' },
        { name: 'Infra', color: 'light-orange' },
        { name: 'Docs', color: 'light-teal' },
      ],
      projects: [2],  // shared only
    },
  ];

  // Create all fields and track their GIDs + per-project assignment
  const cfGids: Record<string, string> = {};  // key → gid
  const cfByProject: Record<number, string[]> = { 0: [], 1: [], 2: [] }; // projIdx → field gids

  for (const cf of cfDefs) {
    try {
      const field = await client.createCustomField(wsId, {
        name: cf.name,
        resource_subtype: cf.resource_subtype,
        ...(cf.enum_options ? { enum_options: cf.enum_options } : {}),
        ...(cf.precision !== undefined ? { precision: cf.precision } : {}),
      });
      cfGids[cf.key] = field.gid;
      manifest.customFields.push({ gid: field.gid, name: cf.name });
      for (const pi of cf.projects) {
        cfByProject[pi].push(field.gid);
      }
      log('  ✓', `Custom field (${cf.resource_subtype}): ${cf.name} (${field.gid}) → projects [${cf.projects.join(',')}]`);
    } catch (e: unknown) {
      log('  ⚠', `Could not create ${cf.name}: ${e instanceof Error ? e.message : e}`);
    }
  }

  // ── 6. Create projects ────────────────────────────────────────
  log('📁', 'Creating projects...');

  const projectConfigs = [
    {
      name: 'AirSync Public Project',
      privacy_setting: 'public_to_workspace' as const,
      notes: 'Public project for AirSync testing. All workspace members can see this.',
    },
    {
      name: 'AirSync Private Admin-Only',
      privacy_setting: 'private' as const,
      notes: 'Private project visible only to the admin user. Used for testing permission isolation.',
    },
    {
      name: 'AirSync Shared Project',
      privacy_setting: 'private' as const,
      notes: 'Private project shared with both admin and guest with different access levels.',
    },
  ];

  const sectionNames = ['Backlog', 'In Progress', 'Done'];
  const projects: { project: AsanaProject; sections: AsanaSection[] }[] = [];

  for (let pi = 0; pi < projectConfigs.length; pi++) {
    const pc = projectConfigs[pi];
    const project = await client.createProject({
      ...pc,
      workspace: wsId,
      team: defaultTeam.gid,
    });
    log('  ✓', `Project: ${pc.name} (${project.gid}) [${pc.privacy_setting}]`);

    const sections: AsanaSection[] = [];
    for (const sn of sectionNames) {
      const section = await client.createSection(project.gid, sn);
      sections.push(section);
      log('    ✓', `Section: ${sn} (${section.gid})`);
    }

    // Add only the custom fields designated for this project
    const fieldsForProject = cfByProject[pi] || [];
    for (const cfGid of fieldsForProject) {
      try {
        await client.addCustomFieldToProject(project.gid, cfGid);
      } catch {
        /* may already be added or insufficient perms */
      }
    }
    if (fieldsForProject.length > 0) {
      log('    ✓', `Added ${fieldsForProject.length} custom field(s) to ${pc.name}`);
    }

    projects.push({ project, sections });
    manifest.projects.push({
      gid: project.gid,
      name: pc.name,
      privacy: pc.privacy_setting,
      sections: sections.map((s) => ({ gid: s.gid, name: s.name || '' })),
    });
  }

  const [publicProj, privateProj, sharedProj] = projects;

  // ── 7. Set project memberships for permission testing ─────────
  log('🔐', 'Setting project memberships...');

  if (guestUser) {
    // Add guest to the shared project as commenter
    try {
      await client.addMembersToProject(sharedProj.project.gid, [guestUser.gid], 'commenter');
      log('  ✓', `Added guest to Shared Project as commenter`);
    } catch (e: unknown) {
      log('  ⚠', `Could not add guest to shared project: ${e instanceof Error ? e.message : e}`);
      // Fallback: try without access_level (API may not support it on Starter)
      try {
        await client.addMembersToProject(sharedProj.project.gid, [guestUser.gid]);
        log('  ✓', `Added guest to Shared Project (default access)`);
      } catch {
        log('  ⚠', 'Failed to add guest to shared project even without access level');
      }
    }
  }

  // ── 8. Create tasks ───────────────────────────────────────────
  log('📝', 'Creating tasks...');

  const allTasks: (AsanaTaskResponse & { projectGid: string })[] = [];

  // Helper to get section GIDs
  const sec = (projIdx: number, secIdx: number) => projects[projIdx].sections[secIdx].gid;
  const proj = (projIdx: number) => projects[projIdx].project.gid;

  // Fetch enum/multi_enum option GIDs for all custom fields
  // Maps cfKey → { optionName → optionGid }
  const enumOptions: Record<string, Record<string, string>> = {};
  try {
    const allFields = await client.getCustomFieldsForWorkspace(wsId);
    for (const [key, gid] of Object.entries(cfGids)) {
      const match = allFields.find((f) => f.gid === gid);
      if (match?.enum_options) {
        enumOptions[key] = {};
        for (const opt of match.enum_options) {
          enumOptions[key][opt.name] = opt.gid;
        }
        log('  ✓', `${key} options: ${Object.entries(enumOptions[key]).map(([k, v]) => `${k}=${v}`).join(', ')}`);
      }
    }
  } catch {
    /* skip */
  }

  // ─── Public project tasks (4 tasks) ───────────────────────────

  // Helper to build custom_fields only for fields that exist
  const cf = (key: string) => cfGids[key];
  const enumOpt = (key: string, name: string) => enumOptions[key]?.[name];

  const pubTask1 = await client.createTask({
    name: 'Implement user authentication',
    projects: [proj(0)],
    assignee: adminUser.gid,
    notes:
      'User authentication module\n\n' +
      'Implement OAuth2 flow with refresh tokens.\n' +
      'Please review the security considerations.',
    due_on: futureDate(14),
    start_on: pastDate(3),
    custom_fields: {
      ...(cf('priorityNote') ? { [cf('priorityNote')]: 'Critical for launch' } : {}),
      ...(cf('status') && enumOpt('status', 'In Progress')
        ? { [cf('status')]: enumOpt('status', 'In Progress') }
        : {}),
      ...(cf('estimate') ? { [cf('estimate')]: '8' } : {}),
    },
  });
  // Place task in correct section
  await client.addTaskToSection(sec(0, 1), pubTask1.gid);
  allTasks.push({ ...pubTask1, projectGid: proj(0) });
  manifest.tasks.push({ gid: pubTask1.gid, name: pubTask1.name!, projectGid: proj(0) });
  log('  ✓', `Task: ${pubTask1.name} (${pubTask1.gid}) [Public / In Progress]`);

  const pubTask2 = await client.createTask({
    name: 'Design database schema',
    projects: [proj(0)],
    assignee: guestUser?.gid,
    notes: 'Design the relational database schema for user management and task tracking.',
    due_on: futureDate(7),
    start_on: pastDate(1),
    custom_fields: {
      ...(cf('priorityNote') ? { [cf('priorityNote')]: 'Medium priority' } : {}),
      ...(cf('status') && enumOpt('status', 'Not Started')
        ? { [cf('status')]: enumOpt('status', 'Not Started') }
        : {}),
      ...(cf('estimate') ? { [cf('estimate')]: '5' } : {}),
    },
  });
  await client.addTaskToSection(sec(0, 0), pubTask2.gid);
  allTasks.push({ ...pubTask2, projectGid: proj(0) });
  manifest.tasks.push({ gid: pubTask2.gid, name: pubTask2.name!, projectGid: proj(0) });
  log('  ✓', `Task: ${pubTask2.name} (${pubTask2.gid}) [Public / Backlog]`);

  const pubTask3 = await client.createTask({
    name: 'Write API documentation',
    projects: [proj(0)],
    notes: 'Comprehensive API docs with request/response examples for all endpoints.',
    due_on: futureDate(21),
  });
  await client.addTaskToSection(sec(0, 0), pubTask3.gid);
  allTasks.push({ ...pubTask3, projectGid: proj(0) });
  manifest.tasks.push({ gid: pubTask3.gid, name: pubTask3.name!, projectGid: proj(0) });
  log('  ✓', `Task: ${pubTask3.name} (${pubTask3.gid}) [Public / Backlog / unassigned]`);

  const pubTask4 = await client.createTask({
    name: 'Set up CI/CD pipeline',
    projects: [proj(0)],
    assignee: adminUser.gid,
    notes: 'Configure GitHub Actions for automated testing, linting, and deployment.',
    completed: true,
    custom_fields: {
      ...(cf('priorityNote') ? { [cf('priorityNote')]: 'Completed ahead of schedule' } : {}),
      ...(cf('estimate') ? { [cf('estimate')]: '3' } : {}),
    },
  });
  await client.addTaskToSection(sec(0, 2), pubTask4.gid);
  allTasks.push({ ...pubTask4, projectGid: proj(0) });
  manifest.tasks.push({ gid: pubTask4.gid, name: pubTask4.name!, projectGid: proj(0) });
  log('  ✓', `Task: ${pubTask4.name} (${pubTask4.gid}) [Public / Done / completed]`);

  // ─── Private admin-only project tasks (2 tasks) ───────────────

  const privTask1 = await client.createTask({
    name: 'Internal security audit',
    projects: [proj(1)],
    assignee: adminUser.gid,
    notes: 'Conduct internal security audit of all API endpoints.\nConfidential - admin eyes only.',
    due_on: futureDate(30),
    start_on: pastDate(5),
    custom_fields: {
      ...(cf('severity') && enumOpt('severity', 'Critical')
        ? { [cf('severity')]: enumOpt('severity', 'Critical') }
        : {}),
    },
  });
  await client.addTaskToSection(sec(1, 1), privTask1.gid);
  allTasks.push({ ...privTask1, projectGid: proj(1) });
  manifest.tasks.push({ gid: privTask1.gid, name: privTask1.name!, projectGid: proj(1) });
  log('  ✓', `Task: ${privTask1.name} (${privTask1.gid}) [Private / In Progress]`);

  const privTask2 = await client.createTask({
    name: 'Archive legacy credentials',
    projects: [proj(1)],
    assignee: adminUser.gid,
    notes: 'Rotate and archive all legacy service account credentials.',
    completed: true,
    custom_fields: {
      ...(cf('severity') && enumOpt('severity', 'Medium')
        ? { [cf('severity')]: enumOpt('severity', 'Medium') }
        : {}),
    },
  });
  await client.addTaskToSection(sec(1, 2), privTask2.gid);
  allTasks.push({ ...privTask2, projectGid: proj(1) });
  manifest.tasks.push({ gid: privTask2.gid, name: privTask2.name!, projectGid: proj(1) });
  log('  ✓', `Task: ${privTask2.name} (${privTask2.gid}) [Private / Done / completed]`);

  // ─── Shared project tasks (3 tasks) ───────────────────────────

  const sharedTask1 = await client.createTask({
    name: 'Create onboarding checklist',
    projects: [proj(2)],
    assignee: adminUser.gid,
    notes:
      'Build a step-by-step onboarding checklist for new team members.\n' +
      'Include setup guides for dev environment, access provisioning, and training materials.',
    due_on: futureDate(10),
    start_on: pastDate(2),
    custom_fields: {
      ...(cf('priorityNote') ? { [cf('priorityNote')]: 'Key deliverable for Q2' } : {}),
      ...(cf('sprint') && enumOpt('sprint', 'Sprint 2')
        ? { [cf('sprint')]: enumOpt('sprint', 'Sprint 2') }
        : {}),
      ...(cf('labels') && enumOpt('labels', 'Docs')
        ? { [cf('labels')]: [enumOpt('labels', 'Docs')] }
        : {}),
    },
  });
  await client.addTaskToSection(sec(2, 1), sharedTask1.gid);
  allTasks.push({ ...sharedTask1, projectGid: proj(2) });
  manifest.tasks.push({ gid: sharedTask1.gid, name: sharedTask1.name!, projectGid: proj(2) });
  log('  ✓', `Task: ${sharedTask1.name} (${sharedTask1.gid}) [Shared / In Progress]`);

  const sharedTask2 = await client.createTask({
    name: 'Review integration docs',
    projects: [proj(2)],
    assignee: guestUser?.gid,
    notes: 'Review and provide feedback on the integration documentation draft.',
    due_on: futureDate(5),
    custom_fields: {
      ...(cf('sprint') && enumOpt('sprint', 'Sprint 1')
        ? { [cf('sprint')]: enumOpt('sprint', 'Sprint 1') }
        : {}),
      ...(cf('labels') && enumOpt('labels', 'Frontend') && enumOpt('labels', 'Docs')
        ? { [cf('labels')]: [enumOpt('labels', 'Frontend'), enumOpt('labels', 'Docs')] }
        : {}),
    },
  });
  await client.addTaskToSection(sec(2, 0), sharedTask2.gid);
  allTasks.push({ ...sharedTask2, projectGid: proj(2) });
  manifest.tasks.push({ gid: sharedTask2.gid, name: sharedTask2.name!, projectGid: proj(2) });
  log('  ✓', `Task: ${sharedTask2.name} (${sharedTask2.gid}) [Shared / Backlog]`);

  const sharedTask3 = await client.createTask({
    name: 'Prepare demo environment',
    projects: [proj(2)],
    assignee: adminUser.gid,
    notes: 'Set up a clean demo environment with sample data for stakeholder presentations.',
    due_on: futureDate(3),
    custom_fields: {
      ...(cf('priorityNote') ? { [cf('priorityNote')]: 'Blocked on infra provisioning' } : {}),
      ...(cf('sprint') && enumOpt('sprint', 'Sprint 3')
        ? { [cf('sprint')]: enumOpt('sprint', 'Sprint 3') }
        : {}),
      ...(cf('labels') && enumOpt('labels', 'Backend') && enumOpt('labels', 'Infra')
        ? { [cf('labels')]: [enumOpt('labels', 'Backend'), enumOpt('labels', 'Infra')] }
        : {}),
    },
  });
  await client.addTaskToSection(sec(2, 0), sharedTask3.gid);
  allTasks.push({ ...sharedTask3, projectGid: proj(2) });
  manifest.tasks.push({ gid: sharedTask3.gid, name: sharedTask3.name!, projectGid: proj(2) });
  log('  ✓', `Task: ${sharedTask3.name} (${sharedTask3.gid}) [Shared / Backlog / blocked]`);

  // ── 9. Add tags to tasks ──────────────────────────────────────
  log('🏷️', 'Adding tags to tasks...');

  const tagAssignments = [
    { taskGid: pubTask1.gid, tagGid: tags[1].gid },   // feature
    { taskGid: pubTask2.gid, tagGid: tags[1].gid },   // feature
    { taskGid: pubTask3.gid, tagGid: tags[2].gid },   // enhancement
    { taskGid: pubTask4.gid, tagGid: tags[1].gid },   // feature
    { taskGid: privTask1.gid, tagGid: tags[0].gid },  // bug
    { taskGid: sharedTask1.gid, tagGid: tags[2].gid }, // enhancement
    { taskGid: sharedTask2.gid, tagGid: tags[1].gid }, // feature
  ];

  for (const ta of tagAssignments) {
    await client.addTagToTask(ta.taskGid, ta.tagGid);
  }
  log('  ✓', `Added ${tagAssignments.length} tag assignments`);

  // ── 10. Add followers for permission testing ──────────────────
  log('👁️', 'Adding followers to tasks...');

  // pubTask1: both users as followers
  if (guestUser) {
    await client.addFollowersToTask(pubTask1.gid, [guestUser.gid]);
    log('  ✓', `${pubTask1.name}: added guest as follower (admin is creator)`);
  }

  // pubTask2: guest is assignee, admin also follows
  await client.addFollowersToTask(pubTask2.gid, [adminUser.gid]);
  log('  ✓', `${pubTask2.name}: added admin as follower`);

  // pubTask3: no explicit followers (unassigned task)
  log('  ✓', `${pubTask3.name}: no followers (tests no-follower scenario)`);

  // sharedTask1: admin only (already creator/assignee)
  log('  ✓', `${sharedTask1.name}: admin-only follower (creator/assignee)`);

  // sharedTask2: guest is assignee, add admin as follower too
  await client.addFollowersToTask(sharedTask2.gid, [adminUser.gid]);
  log('  ✓', `${sharedTask2.name}: both users following`);

  // sharedTask3: only guest as follower (admin is assignee but remove admin? or just add guest)
  if (guestUser) {
    await client.addFollowersToTask(sharedTask3.gid, [guestUser.gid]);
    log('  ✓', `${sharedTask3.name}: added guest as follower`);
  }

  // ── 11. Create subtasks ───────────────────────────────────────
  log('📎', 'Creating subtasks...');

  // 2 subtasks on pubTask1 (public project)
  const subtask1 = await client.createSubtask(pubTask1.gid, {
    name: 'Implement login endpoint',
    assignee: adminUser.gid,
    notes: 'POST /auth/login with JWT token generation.',
    due_on: futureDate(7),
  });
  manifest.subtasks.push({ gid: subtask1.gid, name: subtask1.name!, parentGid: pubTask1.gid });
  log('  ✓', `Subtask: ${subtask1.name} (${subtask1.gid}) → parent: ${pubTask1.name}`);

  const subtask2 = await client.createSubtask(pubTask1.gid, {
    name: 'Implement logout endpoint',
    assignee: guestUser?.gid,
    notes: 'POST /auth/logout with token invalidation.',
    due_on: futureDate(10),
  });
  manifest.subtasks.push({ gid: subtask2.gid, name: subtask2.name!, parentGid: pubTask1.gid });
  log('  ✓', `Subtask: ${subtask2.name} (${subtask2.gid}) → parent: ${pubTask1.name}`);

  // Sub-subtask on subtask1 (depth 2 — tests MAX_SUBTASK_DEPTH)
  const subSubtask1 = await client.createSubtask(subtask1.gid, {
    name: 'Add rate limiting to login',
    assignee: adminUser.gid,
    notes: 'Limit login attempts to 5 per minute per IP.',
    completed: true,
  });
  manifest.subtasks.push({
    gid: subSubtask1.gid,
    name: subSubtask1.name!,
    parentGid: subtask1.gid,
  });
  log(
    '  ✓',
    `Sub-subtask: ${subSubtask1.name} (${subSubtask1.gid}) → parent: ${subtask1.name} [depth 2]`
  );

  // 1 subtask on sharedTask1 (shared project)
  const subtask3 = await client.createSubtask(sharedTask1.gid, {
    name: 'Draft welcome email template',
    assignee: guestUser?.gid,
    notes: 'Create HTML email template for new member welcome.',
    due_on: futureDate(5),
  });
  manifest.subtasks.push({
    gid: subtask3.gid,
    name: subtask3.name!,
    parentGid: sharedTask1.gid,
  });
  log('  ✓', `Subtask: ${subtask3.name} (${subtask3.gid}) → parent: ${sharedTask1.name}`);

  // ── 12. Add dependencies ──────────────────────────────────────
  log('🔗', 'Adding task dependencies...');

  // pubTask1 depends on pubTask2 (auth depends on DB schema)
  await client.addDependency(pubTask1.gid, pubTask2.gid);
  manifest.dependencies.push({ taskGid: pubTask1.gid, dependsOnGid: pubTask2.gid });
  log('  ✓', `${pubTask1.name} depends on ${pubTask2.name}`);

  // pubTask3 depends on pubTask1 (docs depend on auth being done)
  await client.addDependency(pubTask3.gid, pubTask1.gid);
  manifest.dependencies.push({ taskGid: pubTask3.gid, dependsOnGid: pubTask1.gid });
  log('  ✓', `${pubTask3.name} depends on ${pubTask1.name}`);

  // sharedTask3 depends on sharedTask1 (demo depends on onboarding checklist)
  await client.addDependency(sharedTask3.gid, sharedTask1.gid);
  manifest.dependencies.push({ taskGid: sharedTask3.gid, dependsOnGid: sharedTask1.gid });
  log('  ✓', `${sharedTask3.name} depends on ${sharedTask1.name}`);

  // ── 13. Create comments ───────────────────────────────────────
  log('💬', 'Creating comments...');

  const comment1 = await client.createComment(
    pubTask1.gid,
    'Started working on the OAuth2 implementation. Using the authorization code flow with PKCE.' +
      (guestUser
        ? ` @${guestUser.name} can you review the token storage approach?`
        : ''),
    false
  );
  manifest.comments.push({ gid: comment1.gid, taskGid: pubTask1.gid });
  log('  ✓', `Comment on ${pubTask1.name} (with @mention)`);

  const comment2 = await client.createComment(
    pubTask1.gid,
    'Updated the auth flow to include refresh token rotation. All tests passing.',
    false
  );
  manifest.comments.push({ gid: comment2.gid, taskGid: pubTask1.gid });
  log('  ✓', `Comment on ${pubTask1.name} (plain text)`);

  const comment3 = await client.createComment(
    pubTask2.gid,
    'Draft schema is ready for review. Key tables: users, sessions, tasks, projects.\n' +
      'Please check the foreign key constraints on the sessions table.',
    false
  );
  manifest.comments.push({ gid: comment3.gid, taskGid: pubTask2.gid });
  log('  ✓', `Comment on ${pubTask2.name} (multi-line plain text)`);

  const comment4 = await client.createComment(
    privTask1.gid,
    'Initial scan complete. Found 3 low-severity issues. Documenting remediation steps.',
    false
  );
  manifest.comments.push({ gid: comment4.gid, taskGid: privTask1.gid });
  log('  ✓', `Comment on ${privTask1.name} (private project)`);

  const comment5 = await client.createComment(
    sharedTask1.gid,
    'The onboarding checklist draft is at 80% completion. Still need to add:\n' +
      '- VPN setup instructions\n' +
      '- Code review guidelines\n' +
      '- IDE configuration walkthrough',
    false
  );
  manifest.comments.push({ gid: comment5.gid, taskGid: sharedTask1.gid });
  log('  ✓', `Comment on ${sharedTask1.name} (shared project, list)`);

  const comment6 = await client.createComment(
    sharedTask2.gid,
    'Waiting for the final draft before starting review.',
    false
  );
  manifest.comments.push({ gid: comment6.gid, taskGid: sharedTask2.gid });
  log('  ✓', `Comment on ${sharedTask2.name} (shared project)`);

  // ── 14. Create attachments (real file uploads) ────────────────
  log('📄', 'Generating and uploading file attachments...');

  const fakeFiles = generateFakeFiles();

  // Distribute files across tasks and subtasks:
  //   pubTask1: requirements.txt, screenshot.png
  //   pubTask2: team-roster.csv
  //   pubTask3: app-config.json
  //   privTask1: test-data.txt
  //   sharedTask1: sprint-notes.md
  //   sharedTask2: schema-draft.json
  //   subtask1: (gets the txt file via comment attachment below)
  //   subtask3: screenshot.png duplicate for subtask coverage
  const fileAssignments: { taskGid: string; taskName: string; file: FakeFile }[] = [
    { taskGid: pubTask1.gid, taskName: pubTask1.name!, file: fakeFiles[0] },  // requirements.txt
    { taskGid: pubTask1.gid, taskName: pubTask1.name!, file: fakeFiles[4] },  // screenshot.png
    { taskGid: pubTask2.gid, taskName: pubTask2.name!, file: fakeFiles[1] },  // team-roster.csv
    { taskGid: pubTask3.gid, taskName: pubTask3.name!, file: fakeFiles[2] },  // app-config.json
    { taskGid: privTask1.gid, taskName: privTask1.name!, file: fakeFiles[5] }, // test-data.txt
    { taskGid: sharedTask1.gid, taskName: sharedTask1.name!, file: fakeFiles[3] }, // sprint-notes.md
    { taskGid: sharedTask2.gid, taskName: sharedTask2.name!, file: fakeFiles[6] }, // schema-draft.json
    { taskGid: subtask1.gid, taskName: subtask1.name!, file: fakeFiles[1] },  // team-roster.csv on subtask
    { taskGid: subtask3.gid, taskName: subtask3.name!, file: fakeFiles[4] },  // screenshot.png on subtask
  ];

  for (const fa of fileAssignments) {
    try {
      const att = await client.uploadFileAttachment(
        fa.taskGid,
        fa.file.name,
        fa.file.buffer,
        fa.file.contentType
      );
      manifest.attachments.push({ gid: att.gid, taskGid: fa.taskGid, name: fa.file.name });
      log('  ✓', `Uploaded ${fa.file.name} (${fa.file.contentType}) → ${fa.taskName}`);
    } catch (e: unknown) {
      log('  ✗', `Failed to upload ${fa.file.name} → ${fa.taskName}: ${e instanceof Error ? e.message : e}`);
    }
  }

  // Also keep one external link attachment for variety
  try {
    const extAtt = await client.createExternalAttachment(
      pubTask4.gid,
      'https://developer.devrev.ai/airsync',
      'AirSync Documentation'
    );
    manifest.attachments.push({ gid: extAtt.gid, taskGid: pubTask4.gid, name: 'AirSync Documentation (link)' });
    log('  ✓', `External link: AirSync Documentation → ${pubTask4.name}`);
  } catch (e: unknown) {
    log('  ✗', `Failed to create external attachment: ${e instanceof Error ? e.message : e}`);
  }

  // ── 15. Save manifest and print summary ───────────────────────
  saveManifest(manifest);
  log('💾', `Manifest saved to ${MANIFEST_PATH}`);

  console.log('\n' + '═'.repeat(60));
  log('✅', 'Mock data generation complete!\n');

  console.log('Summary:');
  console.log(`  Workspace:    ${ws.name} (${wsId})`);
  console.log(`  Users:        ${manifest.users.length}`);
  console.log(`  Teams:        ${manifest.teams.length}`);
  console.log(`  Projects:     ${manifest.projects.length}`);
  console.log(`  Tags:         ${manifest.tags.length}`);
  console.log(`  Custom Fields:${manifest.customFields.length}`);
  console.log(`  Tasks:        ${manifest.tasks.length}`);
  console.log(`  Subtasks:     ${manifest.subtasks.length}`);
  console.log(`  Comments:     ${manifest.comments.length}`);
  console.log(`  Attachments:  ${manifest.attachments.length}`);
  console.log(`  Dependencies: ${manifest.dependencies.length}`);

  console.log('\nPermission test scenarios:');
  console.log(`  Public project:  ${publicProj.project.name} (${publicProj.project.gid})`);
  console.log(`  Private project: ${privateProj.project.name} (${privateProj.project.gid})`);
  console.log(`  Shared project:  ${sharedProj.project.name} (${sharedProj.project.gid})`);

  if (guestUser) {
    console.log(`\n  Guest user "${guestUser.name}" has access to:`);
    console.log(`    - Public project (all workspace members)`);
    console.log(`    - Shared project (as commenter)`);
    console.log(`    - NOT the private admin-only project`);
  }

  console.log(`\nUse --cleanup to remove all created resources.`);

  } catch (err) {
    saveOnError();
    throw err;
  }
}

// ─── Entry point ─────────────────────────────────────────────────

async function main() {
  const pat = process.env.ASANA_PAT;
  if (!pat) {
    console.error('ASANA_PAT not set. Add it to code/.env');
    process.exit(1);
  }

  const client = new AsanaMockClient(pat);
  const args = process.argv.slice(2);

  if (args.includes('--cleanup')) {
    await cleanup(client);
  } else {
    await generate(client);
  }
}

main().catch((err) => {
  console.error('\nFatal error:', err.response?.data || err.message || err);
  // Save partial manifest for cleanup if one exists in memory but wasn't saved
  if (!loadManifest()) {
    console.error('No manifest was saved. Check Asana manually for partially created resources.');
  }
  process.exit(1);
});
