import { ExternalSyncUnit } from '@devrev/ts-adaas';

import { AsanaClient } from '@asana/api-client';
import { ItemType } from '@asana/constants';
import type { AsanaProject } from '@asana/types';
import { serializeError } from '@utils/serialize-error';

/** Check and log warnings if the authorizing user lacks admin access to the workspace. */
export async function checkUserWorkspaceRole(asanaClient: AsanaClient): Promise<void> {
  try {
    const response = await asanaClient.getWorkspaceMembershipsForMe();
    const memberships = response.data?.data ?? [];
    const membership = memberships.find(
      (m: { workspace?: { gid?: string } }) => m.workspace?.gid === asanaClient.workspaceId
    );

    if (!membership) {
      console.warn(
        `Could not find workspace membership for workspace ${asanaClient.workspaceId}. ` +
          'Unable to verify if the authorizing user is a workspace admin.'
      );
      return;
    }

    if (membership.is_guest) {
      console.warn(
        'The authorizing user is a GUEST in this Asana workspace. ' +
          'Guests have very limited visibility and most projects will not be available for sync. ' +
          'Use a workspace admin account to authorize the connection for full project visibility.'
      );
    } else if (!membership.is_admin) {
      console.warn(
        'The authorizing user is not a workspace admin in Asana. ' +
          'Only projects the user is a member of will appear in the sync unit list. ' +
          'Private projects the user has not been added to will not be visible. ' +
          'Use a workspace admin account to authorize the connection for full project visibility.'
      );
    }
  } catch (error) {
    console.warn(`Unable to check workspace membership role: ${serializeError(error)}`);
  }
}

/** Fetch all projects from the Asana workspace with pagination. */
export async function fetchAllProjects(asanaClient: AsanaClient): Promise<AsanaProject[]> {
  const projects: AsanaProject[] = [];
  let nextPageOffset: string | undefined;

  do {
    const projectListResponse = await asanaClient.getProjects({
      limit: 100,
      offset: nextPageOffset,
    });

    projects.push(...(projectListResponse.data.data ?? []));
    nextPageOffset = projectListResponse.data.next_page?.offset;
  } while (nextPageOffset);

  return projects;
}

const BATCH_SIZE = 10;

/** Build external sync unit descriptors from Asana projects, including task counts. */
export async function buildExternalSyncUnits(
  projects: AsanaProject[],
  asanaClient: AsanaClient
): Promise<ExternalSyncUnit[]> {
  const results: ExternalSyncUnit[] = [];

  for (let i = 0; i < projects.length; i += BATCH_SIZE) {
    const batch = projects.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (project) => {
        let itemCount = 0;
        try {
          const responseProject = await asanaClient.getProjectTaskCount(project.gid!);
          itemCount = responseProject?.data?.data?.num_tasks ?? 0;
        } catch (error) {
          console.warn(`Error fetching project task count for project ${project.gid}: ${serializeError(error)}`);
        }

        return {
          id: project.gid!,
          name: project.name ?? 'Unnamed Project',
          description: project.resource_type ?? '',
          item_type: ItemType.TASKS,
          item_count: itemCount,
        };
      })
    );
    results.push(...batchResults);
  }

  return results;
}
