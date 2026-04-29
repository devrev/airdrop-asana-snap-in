import { ItemType } from '@asana/constants';

import { extractPermissions } from './permissions-helpers';

describe('extractPermissions', () => {
  const mockPush = jest.fn();

  function createPermissionsAdapter(overrides?: { isTimeout?: boolean; accessRulesCompleted?: boolean }) {
    return {
      isTimeout: overrides?.isTimeout ?? false,
      state: {
        groups: { completed: false, offset: '', total: 0 },
        group_memberships: { completed: false, total: 0 },
        access_rules: { completed: overrides?.accessRulesCompleted ?? false, total: 0 },
      },
      getRepo: jest.fn().mockReturnValue({ push: mockPush }),
    } as any;
  }

  function createPermissionsClient(options: {
    privacySetting?: string;
    memberships?: { memberGid: string; memberType: string; memberName: string; accessLevel: string }[];
    teamMembers?: Record<string, { gid: string }[]>;
    workspaceUsers?: { gid: string }[];
    workspaceTeams?: { gid: string }[];
  }) {
    const memberships = (options.memberships ?? []).map((m) => ({
      gid: `pm_${m.memberGid}`,
      member: { gid: m.memberGid, resource_type: m.memberType, name: m.memberName },
      access_level: m.accessLevel,
    }));

    return {
      getProject: jest.fn().mockResolvedValue({
        data: { data: { privacy_setting: options.privacySetting ?? 'private' } },
      }),
      getProjectMembershipsForProject: jest.fn().mockResolvedValue({
        data: { data: memberships, next_page: null },
      }),
      getTeamMembershipsForTeam: jest.fn().mockImplementation((teamGid: string) => {
        const members = options.teamMembers?.[teamGid] ?? [];
        return Promise.resolve({
          data: {
            data: members.map((m) => ({ user: m })),
            next_page: null,
          },
        });
      }),
      getUsersForWorkspace: jest.fn().mockResolvedValue({
        data: {
          data: options.workspaceUsers ?? [],
          next_page: null,
        },
      }),
      getTeamsForWorkspace: jest.fn().mockResolvedValue({
        data: {
          data: options.workspaceTeams ?? [],
          next_page: null,
        },
      }),
    } as any;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should skip extraction if already completed', async () => {
    const client = createPermissionsClient({});
    const adapter = createPermissionsAdapter({ accessRulesCompleted: true });

    await extractPermissions(client, adapter);

    expect(client.getProject).not.toHaveBeenCalled();
  });

  it('should extract user memberships and create access rules', async () => {
    const client = createPermissionsClient({
      memberships: [
        { memberGid: 'u1', memberType: 'user', memberName: 'Alice', accessLevel: 'admin' },
        { memberGid: 'u2', memberType: 'user', memberName: 'Bob', accessLevel: 'viewer' },
      ],
    });
    const adapter = createPermissionsAdapter();

    await extractPermissions(client, adapter);

    expect(adapter.state.access_rules.completed).toBe(true);
    expect(adapter.state.access_rules.total).toBe(2);
    expect(adapter.state.groups.total).toBe(0);
  });

  it('should reference team members in access rules without creating groups', async () => {
    const client = createPermissionsClient({
      memberships: [
        { memberGid: 'team-1', memberType: 'team', memberName: 'Engineering', accessLevel: 'editor' },
      ],
    });
    const adapter = createPermissionsAdapter();

    await extractPermissions(client, adapter);

    expect(adapter.state.groups.total).toBe(0);
    expect(adapter.state.group_memberships.total).toBe(0);
    expect(adapter.state.access_rules.total).toBe(1);
  });

  it('should add workspace users and teams as viewers for public_to_workspace projects', async () => {
    const client = createPermissionsClient({
      privacySetting: 'public_to_workspace',
      memberships: [
        { memberGid: 'u1', memberType: 'user', memberName: 'Alice', accessLevel: 'admin' },
      ],
      workspaceUsers: [{ gid: 'u1' }, { gid: 'u2' }, { gid: 'u3' }],
      workspaceTeams: [{ gid: 't1' }, { gid: 't2' }],
    });
    const adapter = createPermissionsAdapter();

    await extractPermissions(client, adapter);

    expect(client.getUsersForWorkspace).toHaveBeenCalled();
    expect(client.getTeamsForWorkspace).toHaveBeenCalled();
    // Should have 2 rules: admin (u1) + viewer (users: u2, u3 + groups: t1, t2)
    expect(adapter.state.access_rules.total).toBe(2);

    // Verify the viewer rule includes permission_groups
    const pushCalls = (adapter.getRepo(ItemType.ACCESS_RULES)?.push as jest.Mock).mock.calls;
    const viewerRule = pushCalls.find(
      (call: any) => call[0][0].id === 'access_rule_viewer'
    )?.[0][0];
    expect(viewerRule).toBeDefined();
    expect(viewerRule.data.permission_groups).toEqual(['t1', 't2']);
  });

  it('should create a single read rule for commenter access level', async () => {
    const client = createPermissionsClient({
      memberships: [
        { memberGid: 'u1', memberType: 'user', memberName: 'Alice', accessLevel: 'commenter' },
      ],
    });
    const adapter = createPermissionsAdapter();

    await extractPermissions(client, adapter);

    // Commenter gets read on tasks/subtasks only; comments inherit from parent
    expect(adapter.state.access_rules.total).toBe(1);
  });

  it('should stop on timeout before access rules generation', async () => {
    const client = createPermissionsClient({
      memberships: [
        { memberGid: 'u1', memberType: 'user', memberName: 'Alice', accessLevel: 'admin' },
      ],
    });
    const adapter = createPermissionsAdapter();
    // Set timeout during membership fetching so it triggers before access rule creation
    client.getProjectMembershipsForProject.mockImplementation(() => {
      adapter.isTimeout = true;
      return Promise.resolve({
        data: {
          data: [{ gid: 'pm_u1', member: { gid: 'u1', resource_type: 'user', name: 'Alice' }, access_level: 'admin' }],
          next_page: null,
        },
      });
    });

    await extractPermissions(client, adapter);

    expect(adapter.state.access_rules.completed).toBe(false);
  });

  it('should handle empty project memberships', async () => {
    const client = createPermissionsClient({ memberships: [] });
    const adapter = createPermissionsAdapter();

    await extractPermissions(client, adapter);

    expect(adapter.state.access_rules.completed).toBe(true);
    expect(adapter.state.access_rules.total).toBe(0);
  });
});
