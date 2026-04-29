import { WorkerAdapter } from '@devrev/ts-adaas';

import { AsanaClient } from '@asana/api-client';
import { AccessLevel, ItemType } from '@asana/constants';
import { normalizeAsanaAccessRule } from '@asana/data-normalization';
import type { AsanaAccessRulePrivilege, AsanaProjectMembership } from '@asana/types';

import type { ExtractorState } from '../functions/extraction/index';

const ACCESS_LEVEL_PRIVILEGES: Record<string, AsanaAccessRulePrivilege[]> = {
  [AccessLevel.ADMIN]: ['create', 'read', 'update', 'delete'],
  [AccessLevel.EDITOR]: ['create', 'read', 'update', 'delete'],
  [AccessLevel.COMMENTER]: ['read'],
  [AccessLevel.VIEWER]: ['read'],
};

/**
 * Fetch all project memberships with pagination.
 * Returns the raw list of ProjectMembershipCompact objects.
 */
async function fetchAllProjectMemberships(asanaClient: AsanaClient): Promise<AsanaProjectMembership[]> {
  const memberships: AsanaProjectMembership[] = [];
  let offset = '';

  do {
    const response = await asanaClient.getProjectMembershipsForProject({
      ...(offset ? { offset } : {}),
    });
    const page = response.data?.data || [];
    memberships.push(...page);
    offset = response.data?.next_page?.offset || '';
  } while (offset);

  return memberships;
}

/**
 * Fetch all workspace team GIDs for public_to_workspace permission assignment.
 */
async function getAllWorkspaceTeamGids(asanaClient: AsanaClient): Promise<string[]> {
  const teamGids: string[] = [];
  let offset = '';

  do {
    const response = await asanaClient.getTeamsForWorkspace({
      ...(offset ? { offset } : {}),
    });
    const teams = response.data?.data || [];
    for (const team of teams) {
      if (team.gid) {
        teamGids.push(team.gid);
      }
    }
    offset = response.data?.next_page?.offset || '';
  } while (offset);

  return teamGids;
}

/**
 * Fetch all workspace user GIDs for public_to_workspace permission assignment.
 */
async function getAllExtractedUserGids(asanaClient: AsanaClient): Promise<string[]> {
  const userGids: string[] = [];
  let offset = '';

  do {
    const response = await asanaClient.getUsersForWorkspace({
      ...(offset ? { offset } : {}),
    });
    const users = response.data?.data || [];
    for (const user of users) {
      if (user.gid) {
        userGids.push(user.gid);
      }
    }
    offset = response.data?.next_page?.offset || '';
  } while (offset);

  return userGids;
}

/**
 * Extract permissions from Asana project memberships and convert them into
 * DevRev authorization policy records. Groups and group memberships are
 * extracted separately in extractGroups().
 *
 * Flow:
 * 1. Fetch project privacy setting
 * 2. Fetch all project memberships (users and teams with access levels)
 * 3. For public_to_workspace projects: add all workspace users as viewers
 * 4. Create one access_rules record per distinct access level
 */
export async function extractPermissions(
  asanaClient: AsanaClient,
  adapter: WorkerAdapter<ExtractorState>
): Promise<void> {
  if (adapter.state.access_rules.completed) {
    console.log('Permissions extraction already completed, skipping.');
    return;
  }

  console.log('Starting permissions extraction...');

  const projectResponse = await asanaClient.getProject();
  const privacySetting = projectResponse.data?.data?.privacy_setting;
  console.log(`Project privacy setting: ${privacySetting}`);

  const memberships = await fetchAllProjectMemberships(asanaClient);
  console.log(`Fetched ${memberships.length} project memberships.`);

  // Separate members by type and group by access level
  const accessLevelUsers: Record<string, string[]> = {};
  const accessLevelGroups: Record<string, string[]> = {};

  for (const membership of memberships) {
    const accessLevel = membership.access_level ?? AccessLevel.VIEWER;
    const memberGid = membership.member?.gid;
    const memberType = membership.member?.resource_type;

    if (!memberGid) {
      console.warn(`Skipping membership: member data is missing.`);
      continue;
    }

    if (memberType === 'team') {
      if (!accessLevelGroups[accessLevel]) {
        accessLevelGroups[accessLevel] = [];
      }
      accessLevelGroups[accessLevel].push(memberGid);
    } else {
      if (!accessLevelUsers[accessLevel]) {
        accessLevelUsers[accessLevel] = [];
      }
      accessLevelUsers[accessLevel].push(memberGid);
    }
  }

  // For public_to_workspace projects, add all workspace users as viewers
  if (privacySetting === 'public_to_workspace') {
    console.log('Project is public_to_workspace. Adding all workspace users as viewers.');
    const allUserGids = await getAllExtractedUserGids(asanaClient);
    if (!accessLevelUsers[AccessLevel.VIEWER]) {
      accessLevelUsers[AccessLevel.VIEWER] = [];
    }
    const existingViewerSet = new Set(accessLevelUsers[AccessLevel.VIEWER]);
    for (const gid of allUserGids) {
      if (!existingViewerSet.has(gid)) {
        accessLevelUsers[AccessLevel.VIEWER].push(gid);
      }
    }
  }

  // Add all workspace teams as viewer groups so every group gets a role via authorization policy
  const allTeamGids = await getAllWorkspaceTeamGids(asanaClient);
  if (allTeamGids.length > 0) {
    console.log(`Adding ${allTeamGids.length} workspace teams as viewer groups.`);
    if (!accessLevelGroups[AccessLevel.VIEWER]) {
      accessLevelGroups[AccessLevel.VIEWER] = [];
    }
    const existingGroupSet = new Set(accessLevelGroups[AccessLevel.VIEWER]);
    for (const gid of allTeamGids) {
      if (!existingGroupSet.has(gid)) {
        accessLevelGroups[AccessLevel.VIEWER].push(gid);
      }
    }
  }

  if (adapter.isTimeout) {
    console.log('Timeout during permissions extraction (before access rules).');
    return;
  }

  // Build access rules per access level
  // Only tasks and subtasks support object-level access; comments inherit from parent
  const allAccessLevels = new Set([...Object.keys(accessLevelUsers), ...Object.keys(accessLevelGroups)]);
  const recordTypes = ['tasks', 'subtasks'];

  for (const level of allAccessLevels) {
    const userIds = accessLevelUsers[level] ?? [];
    const groupIds = accessLevelGroups[level] ?? [];

    if (userIds.length === 0 && groupIds.length === 0) continue;

    const privileges = ACCESS_LEVEL_PRIVILEGES[level] ?? ACCESS_LEVEL_PRIVILEGES[AccessLevel.VIEWER];

    const rule = normalizeAsanaAccessRule({
      accessLevel: level,
      userIds,
      groupIds,
      privileges,
      recordTypes,
    });
    await adapter.getRepo(ItemType.ACCESS_RULES)?.push([rule]);
    adapter.state.access_rules.total += 1;
  }

  adapter.state.groups.completed = true;
  adapter.state.group_memberships.completed = true;
  adapter.state.access_rules.completed = true;

  console.log(
    `Permissions extraction completed. ` +
      `Groups: ${adapter.state.groups.total}, ` +
      `Group memberships: ${adapter.state.group_memberships.total}, ` +
      `Access rules: ${adapter.state.access_rules.total}.`
  );
}
