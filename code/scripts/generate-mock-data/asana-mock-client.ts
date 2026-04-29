import axios, { AxiosInstance, AxiosError } from 'axios';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const FormData = require('form-data');

const BASE_URL = 'https://app.asana.com/api/1.0';

interface AsanaResponse<T = Record<string, unknown>> {
  data: T;
}

interface AsanaListResponse<T = Record<string, unknown>> {
  data: T[];
  next_page?: { offset: string; uri: string } | null;
}

export interface AsanaResource {
  gid: string;
  name?: string;
  resource_type?: string;
}

export interface AsanaUser extends AsanaResource {
  email?: string;
}

export interface AsanaTeam extends AsanaResource {}

export interface AsanaProject extends AsanaResource {
  privacy_setting?: string;
}

export interface AsanaSection extends AsanaResource {}

export interface AsanaTag extends AsanaResource {}

export interface AsanaTaskResponse extends AsanaResource {
  assignee?: AsanaResource | null;
  followers?: AsanaResource[];
  permalink_url?: string;
}

export interface CreateProjectData {
  name: string;
  workspace: string;
  team?: string;
  notes?: string;
  html_notes?: string;
  color?: string;
  privacy_setting?: 'public_to_workspace' | 'private_to_team' | 'private';
  default_access_level?: 'admin' | 'editor' | 'commenter' | 'viewer';
  public?: boolean;
}

export interface CreateTaskData {
  name: string;
  projects?: string[];
  assignee?: string;
  notes?: string;
  html_notes?: string;
  due_on?: string;
  start_on?: string;
  completed?: boolean;
  followers?: string[];
  tags?: string[];
  custom_fields?: Record<string, string | string[]>;
  resource_subtype?: 'default_task' | 'milestone' | 'approval';
  memberships?: { project: string; section: string }[];
}

export interface CreateSubtaskData {
  name: string;
  assignee?: string;
  notes?: string;
  html_notes?: string;
  due_on?: string;
  start_on?: string;
  completed?: boolean;
  followers?: string[];
}

export class AsanaMockClient {
  private client: AxiosInstance;

  constructor(pat: string) {
    this.client = axios.create({
      baseURL: BASE_URL,
      headers: {
        Authorization: `Bearer ${pat}`,
        'Content-Type': 'application/json',
      },
    });

    this.client.interceptors.response.use(undefined, async (error: AxiosError) => {
      if (error.response?.status === 429) {
        const retryAfter = parseInt(error.response.headers['retry-after'] ?? '60', 10);
        console.log(`  Rate limited. Waiting ${retryAfter}s...`);
        await sleep(retryAfter * 1000);
        return this.client.request(error.config!);
      }
      throw error;
    });
  }

  // ─── Workspace ────────────────────────────────────────────────

  async getWorkspaces(): Promise<AsanaResource[]> {
    const res = await this.client.get<AsanaListResponse<AsanaResource>>('/workspaces');
    return res.data.data;
  }

  // ─── Users ────────────────────────────────────────────────────

  async getUsers(workspaceId: string): Promise<AsanaUser[]> {
    const users: AsanaUser[] = [];
    let offset: string | undefined;
    do {
      const res = await this.client.get<AsanaListResponse<AsanaUser>>('/users', {
        params: {
          workspace: workspaceId,
          opt_fields: 'name,email,resource_type',
          limit: 100,
          ...(offset ? { offset } : {}),
        },
      });
      users.push(...res.data.data);
      offset = res.data.next_page?.offset;
    } while (offset);
    return users;
  }

  // ─── Teams ────────────────────────────────────────────────────

  async getTeams(workspaceId: string): Promise<AsanaTeam[]> {
    const res = await this.client.get<AsanaListResponse<AsanaTeam>>(
      `/organizations/${workspaceId}/teams`,
      { params: { limit: 100 } }
    );
    return res.data.data;
  }

  // ─── Projects ─────────────────────────────────────────────────

  async createProject(data: CreateProjectData): Promise<AsanaProject> {
    const res = await this.client.post<AsanaResponse<AsanaProject>>('/projects', {
      data,
    });
    return res.data.data;
  }

  async deleteProject(gid: string): Promise<void> {
    await this.client.delete(`/projects/${gid}`);
  }

  async addMembersToProject(
    projectGid: string,
    members: string[],
    accessLevel?: 'admin' | 'editor' | 'commenter' | 'viewer'
  ): Promise<void> {
    await this.client.post(`/projects/${projectGid}/addMembers`, {
      data: {
        members,
        ...(accessLevel ? { access_level: accessLevel } : {}),
      },
    });
  }

  // ─── Sections ─────────────────────────────────────────────────

  async createSection(projectGid: string, name: string): Promise<AsanaSection> {
    const res = await this.client.post<AsanaResponse<AsanaSection>>(
      `/projects/${projectGid}/sections`,
      { data: { name } }
    );
    return res.data.data;
  }

  async deleteSection(gid: string): Promise<void> {
    await this.client.delete(`/sections/${gid}`);
  }

  // ─── Tags ─────────────────────────────────────────────────────

  async createTag(workspaceId: string, name: string, color?: string): Promise<AsanaTag> {
    const res = await this.client.post<AsanaResponse<AsanaTag>>('/tags', {
      data: { workspace: workspaceId, name, ...(color ? { color } : {}) },
    });
    return res.data.data;
  }

  async deleteTag(gid: string): Promise<void> {
    await this.client.delete(`/tags/${gid}`);
  }

  async addTagToTask(taskGid: string, tagGid: string): Promise<void> {
    await this.client.post(`/tasks/${taskGid}/addTag`, {
      data: { tag: tagGid },
    });
  }

  // ─── Custom Fields ────────────────────────────────────────────

  async createCustomField(
    workspaceId: string,
    data: {
      name: string;
      resource_subtype: 'text' | 'number' | 'enum' | 'multi_enum';
      enum_options?: { name: string; color?: string }[];
      precision?: number;
    }
  ): Promise<AsanaResource> {
    const res = await this.client.post<AsanaResponse<AsanaResource>>('/custom_fields', {
      data: { workspace: workspaceId, ...data },
    });
    return res.data.data;
  }

  async deleteCustomField(gid: string): Promise<void> {
    await this.client.delete(`/custom_fields/${gid}`);
  }

  async addCustomFieldToProject(projectGid: string, customFieldGid: string): Promise<void> {
    await this.client.post(`/projects/${projectGid}/addCustomFieldSetting`, {
      data: { custom_field: customFieldGid },
    });
  }

  async getCustomFieldsForWorkspace(
    workspaceId: string
  ): Promise<(AsanaResource & { resource_subtype?: string; enum_options?: { gid: string; name: string }[] })[]> {
    const res = await this.client.get<
      AsanaListResponse<AsanaResource & { resource_subtype?: string; enum_options?: { gid: string; name: string }[] }>
    >(`/workspaces/${workspaceId}/custom_fields`, {
      params: { opt_fields: 'name,resource_subtype,enum_options,enum_options.name', limit: 100 },
    });
    return res.data.data;
  }

  // ─── Tasks ────────────────────────────────────────────────────

  async createTask(data: CreateTaskData): Promise<AsanaTaskResponse> {
    const res = await this.client.post<AsanaResponse<AsanaTaskResponse>>('/tasks', {
      data,
    });
    return res.data.data;
  }

  async deleteTask(gid: string): Promise<void> {
    await this.client.delete(`/tasks/${gid}`);
  }

  async addFollowersToTask(taskGid: string, followers: string[]): Promise<void> {
    await this.client.post(`/tasks/${taskGid}/addFollowers`, {
      data: { followers },
    });
  }

  async addTaskToSection(sectionGid: string, taskGid: string): Promise<void> {
    await this.client.post(`/sections/${sectionGid}/addTask`, {
      data: { task: taskGid },
    });
  }

  // ─── Subtasks ─────────────────────────────────────────────────

  async createSubtask(parentGid: string, data: CreateSubtaskData): Promise<AsanaTaskResponse> {
    const res = await this.client.post<AsanaResponse<AsanaTaskResponse>>(
      `/tasks/${parentGid}/subtasks`,
      { data }
    );
    return res.data.data;
  }

  // ─── Dependencies ─────────────────────────────────────────────

  async addDependency(taskGid: string, dependsOnGid: string): Promise<void> {
    await this.client.post(`/tasks/${taskGid}/addDependencies`, {
      data: { dependencies: [dependsOnGid] },
    });
  }

  // ─── Comments (Stories) ───────────────────────────────────────

  async createComment(
    taskGid: string,
    text: string,
    isHtml = false
  ): Promise<AsanaResource> {
    const body = isHtml ? { html_text: text } : { text };
    const res = await this.client.post<AsanaResponse<AsanaResource>>(
      `/tasks/${taskGid}/stories`,
      { data: body }
    );
    return res.data.data;
  }

  // ─── Attachments ──────────────────────────────────────────────

  async createExternalAttachment(
    taskGid: string,
    url: string,
    name: string
  ): Promise<AsanaResource> {
    const res = await this.client.post<AsanaResponse<AsanaResource>>('/attachments', {
      data: {
        parent: taskGid,
        resource_subtype: 'external',
        url,
        name,
      },
    });
    return res.data.data;
  }

  async uploadFileAttachment(
    taskGid: string,
    fileName: string,
    fileBuffer: Buffer,
    contentType: string
  ): Promise<AsanaResource> {
    const form = new FormData();
    form.append('parent', taskGid);
    form.append('file', fileBuffer, { filename: fileName, contentType });

    const res = await this.client.post<AsanaResponse<AsanaResource>>(
      '/attachments',
      form,
      { headers: form.getHeaders() }
    );
    return res.data.data;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
