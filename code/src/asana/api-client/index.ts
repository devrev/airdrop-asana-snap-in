import { AirdropEvent } from '@devrev/ts-adaas';
import axios, { AxiosInstance, AxiosResponse } from 'axios';
import axiosRetry from 'axios-retry';

import { serializeError } from '@utils/serialize-error';

import {
  AddAsanaDependenciesRequest,
  AddAsanaTagToTaskRequest,
  AddAsanaTaskToProjectRequest,
  AddAsanaTaskToSectionRequest,
  CreateAsanaCommentRequest,
  CreateAsanaTaskRequest,
  CreateAsanaTaskResponse,
  GetAsanaCustomFieldSettingsRequest,
  GetAsanaCustomFieldSettingsResponse,
  GetAsanaMembershipsRequest,
  GetAsanaMembershipsResponse,
  GetAsanaProjectMembershipsRequest,
  GetAsanaProjectMembershipsResponse,
  GetAsanaProjectResponse,
  GetAsanaProjectsRequest,
  GetAsanaProjectsResponse,
  GetAsanaProjectTaskCountResponse,
  GetAsanaSectionsRequest,
  GetAsanaSectionsResponse,
  GetAsanaStoriesRequest,
  GetAsanaStoriesResponse,
  GetAsanaSubtasksRequest,
  GetAsanaSubtasksResponse,
  GetAsanaTagsRequest,
  GetAsanaTagsResponse,
  GetAsanaTasksRequest,
  GetAsanaTasksResponse,
  GetAsanaTeamMembershipsRequest,
  GetAsanaTeamMembershipsResponse,
  GetAsanaTeamsRequest,
  GetAsanaTeamsResponse,
  GetAsanaUserResponse,
  GetAsanaUsersResponse,
  PaginatedRequestWithLimit,
  RemoveAsanaTagFromTaskRequest,
  SetAsanaParentRequest,
  UpdateAsanaTaskRequest,
} from '../types';

const ASANA_API_BASE_URL = 'https://app.asana.com/api/1.0';
const ASANA_PAGE_LIMIT = 100;

const TASK_FIELDS = [
  'name',
  'resource_subtype',
  'created_by',
  'approval_status',
  'completed',
  'completed_at',
  'completed_by',
  'created_at',
  'modified_at',
  'due_at',
  'due_on',
  'start_at',
  'start_on',
  'html_notes',
  'notes',
  'liked',
  'num_likes',
  'num_subtasks',
  'actual_time_minutes',
  'permalink_url',
  'assignee',
  'assignee.name',
  'assignee.email',
  'assignee_section',
  'assignee_section.name',
  'parent',
  'parent.name',
  'followers',
  'followers.name',
  'followers.email',
  'tags',
  'tags.name',
  'tags.color',
  'projects',
  'projects.name',
  'memberships',
  'memberships.project',
  'memberships.project.name',
  'memberships.section',
  'memberships.section.name',
  'custom_fields',
  'custom_fields.name',
  'custom_fields.display_value',
  'custom_fields.type',
  'custom_fields.enum_value',
  'custom_fields.enum_value.name',
  'custom_fields.enum_value.color',
  'custom_fields.multi_enum_values',
  'custom_fields.multi_enum_values.name',
  'custom_fields.number_value',
  'custom_fields.text_value',
  'custom_fields.date_value',
  'custom_fields.people_value',
  'custom_fields.people_value.name',
  'dependencies',
  'dependencies.name',
  'dependents',
  'dependents.name',
  'attachments',
  'attachments.name',
  'attachments.size',
  'attachments.download_url',
  'attachments.resource_type',
  'attachments.created_at',
  'attachments.permanent_url',
].join(',');

const USER_FIELDS = ['name', 'email'].join(',');
const TAGS_FIELDS = ['name', 'color', 'created_at', 'notes'].join(',');
const CUSTOM_FIELD_SETTINGS_FIELDS = [
  'custom_field.name',
  'custom_field.type',
  'custom_field.resource_subtype',
  'custom_field.description',
  'custom_field.enum_options',
  'custom_field.enum_options.name',
  'custom_field.enum_options.color',
  'custom_field.enum_options.enabled',
].join(',');
const STORIES_FIELDS = [
  'created_at',
  'created_by',
  'created_by.name',
  'created_by.email',
  'text',
  'html_text',
  'type',
  'resource_subtype',
  'target',
  'target.gid',
  'target.name',
  'target.resource_subtype',
].join(',');
const SECTIONS_FIELDS = ['name'].join(',');
const PROJECT_FIELDS = ['privacy_setting'].join(',');

/** HTTP client for the Asana REST API with automatic retry and pagination support. */
export class AsanaClient {
  private httpClient: AxiosInstance;
  public workspaceId: string;
  public projectId: string;

  constructor(event: AirdropEvent) {
    const apiKey = event.payload.connection_data.key;
    this.workspaceId = event.payload.connection_data.org_id;
    this.projectId = event.payload.event_context.external_sync_unit_id;

    const axiosInstance = axios.create({
      baseURL: ASANA_API_BASE_URL,
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    axiosRetry(axiosInstance, {
      retries: 3,
      retryDelay: (retryCount, error) => {
        const delay = 2 ** retryCount * 1000;
        const delaySeconds = (delay / 1000).toFixed(1);
        console.warn(`HTTP Retry: Attempt ${retryCount}/3 - Waiting ${delaySeconds}s - ${serializeError(error)}`);
        return delay;
      },
      retryCondition: (error) => {
        if (!error.response) {
          return true;
        }
        const { status } = error.response;
        // Retry on 5xx server errors only
        return status >= 500 && status < 600;
      },
    });

    this.httpClient = axiosInstance;
  }

  /** Fetch paginated tasks for the configured project. */
  async getTasks(params: GetAsanaTasksRequest): Promise<AxiosResponse<GetAsanaTasksResponse>> {
    return this.httpClient.get(`/projects/${this.projectId}/tasks`, {
      params: {
        limit: ASANA_PAGE_LIMIT,
        opt_fields: TASK_FIELDS,
        ...params,
      },
    });
  }

  /** Fetch paginated subtasks for a given task. */
  async getSubtasksForTask(
    taskGid: string,
    params?: GetAsanaSubtasksRequest
  ): Promise<AxiosResponse<GetAsanaSubtasksResponse>> {
    return this.httpClient.get(`/tasks/${taskGid}/subtasks`, {
      params: {
        limit: ASANA_PAGE_LIMIT,
        opt_fields: TASK_FIELDS,
        ...params,
      },
    });
  }

  /** Fetch paginated projects for the configured workspace. */
  async getProjects(params: GetAsanaProjectsRequest): Promise<AxiosResponse<GetAsanaProjectsResponse>> {
    return this.httpClient.get(`/workspaces/${this.workspaceId}/projects`, { params });
  }

  /** Get the total task count for a project. */
  async getProjectTaskCount(projectId: string): Promise<AxiosResponse<GetAsanaProjectTaskCountResponse>> {
    return this.httpClient.get(`/projects/${projectId}/task_counts`, {
      params: { opt_fields: 'num_tasks' },
    });
  }

  /** Fetch paginated memberships for the configured project. */
  async getMembershipsForProject(params: GetAsanaMembershipsRequest): Promise<AxiosResponse<GetAsanaMembershipsResponse>> {
    return this.httpClient.get(`/memberships`, {
      params: {
        parent: this.projectId,
        limit: ASANA_PAGE_LIMIT,
        ...params,
      },
    });
  }

  /** Fetch a single user by GID. */
  async getUser(userGid: string): Promise<AxiosResponse<GetAsanaUserResponse>> {
    return this.httpClient.get(`/users/${userGid}`, {
      params: { opt_fields: USER_FIELDS },
    });
  }

  /** Fetch paginated users for the configured workspace. */
  async getUsersForWorkspace(params?: PaginatedRequestWithLimit): Promise<AxiosResponse<GetAsanaUsersResponse>> {
    return this.httpClient.get('/users', {
      params: {
        workspace: this.workspaceId,
        limit: ASANA_PAGE_LIMIT,
        opt_fields: USER_FIELDS,
        ...params,
      },
    });
  }

  /** Fetch paginated tags for the configured workspace. */
  async getTagsForWorkspace(params: GetAsanaTagsRequest): Promise<AxiosResponse<GetAsanaTagsResponse>> {
    return this.httpClient.get(`/workspaces/${this.workspaceId}/tags`, {
      params: {
        limit: ASANA_PAGE_LIMIT,
        opt_fields: TAGS_FIELDS,
        ...params,
      },
    });
  }

  /** Fetch custom field settings for the configured project. */
  async getCustomFieldSettingsForProject(
    params?: GetAsanaCustomFieldSettingsRequest
  ): Promise<AxiosResponse<GetAsanaCustomFieldSettingsResponse>> {
    return this.httpClient.get(`/projects/${this.projectId}/custom_field_settings`, {
      params: {
        limit: ASANA_PAGE_LIMIT,
        opt_fields: CUSTOM_FIELD_SETTINGS_FIELDS,
        ...params,
      },
    });
  }

  /** Fetch paginated stories (comments) for a given task. */
  async getStoriesForTask(
    taskGid: string,
    params?: GetAsanaStoriesRequest
  ): Promise<AxiosResponse<GetAsanaStoriesResponse>> {
    return this.httpClient.get(`/tasks/${taskGid}/stories`, {
      params: {
        limit: ASANA_PAGE_LIMIT,
        opt_fields: STORIES_FIELDS,
        ...params,
      },
    });
  }

  /** Fetch workspace memberships for the authenticated user. */
  async getWorkspaceMembershipsForMe(): Promise<AxiosResponse> {
    return this.httpClient.get('/users/me/workspace_memberships', {
      params: {
        opt_fields: 'is_admin,is_guest,workspace,workspace.name',
      },
    });
  }

  /** Fetch paginated sections for the configured project. */
  async getSectionsForProject(params?: GetAsanaSectionsRequest): Promise<AxiosResponse<GetAsanaSectionsResponse>> {
    return this.httpClient.get(`/projects/${this.projectId}/sections`, {
      params: {
        limit: ASANA_PAGE_LIMIT,
        opt_fields: SECTIONS_FIELDS,
        ...params,
      },
    });
  }

  /** Fetch the configured project's details (e.g. privacy_setting). */
  async getProject(): Promise<AxiosResponse<GetAsanaProjectResponse>> {
    return this.httpClient.get(`/projects/${this.projectId}`, {
      params: { opt_fields: PROJECT_FIELDS },
    });
  }

  /** Create a new task in Asana. */
  async createTask(payload: CreateAsanaTaskRequest): Promise<AxiosResponse<CreateAsanaTaskResponse>> {
    return this.httpClient.post('/tasks', payload);
  }

  /** Update an existing task by GID. */
  async updateTask(taskGid: string, payload: UpdateAsanaTaskRequest): Promise<AxiosResponse<CreateAsanaTaskResponse>> {
    return this.httpClient.put(`/tasks/${taskGid}`, payload);
  }

  /** Create a subtask under the given parent task. */
  async createTaskSubtask(
    parentTaskGid: string,
    payload: CreateAsanaTaskRequest
  ): Promise<AxiosResponse<CreateAsanaTaskResponse>> {
    return this.httpClient.post(`/tasks/${parentTaskGid}/subtasks`, payload);
  }

  /** Post a comment (story) on a task. */
  async createTaskComment(taskGid: string, payload: CreateAsanaCommentRequest): Promise<AxiosResponse> {
    return this.httpClient.post(`/tasks/${taskGid}/stories`, payload);
  }

  /** Add dependency relationships to a task. */
  async addTaskDependencies(taskGid: string, payload: AddAsanaDependenciesRequest): Promise<AxiosResponse> {
    return this.httpClient.post(`/tasks/${taskGid}/addDependencies`, payload);
  }

  /** Remove dependency relationships from a task. */
  async removeTaskDependencies(taskGid: string, payload: AddAsanaDependenciesRequest): Promise<AxiosResponse> {
    return this.httpClient.post(`/tasks/${taskGid}/removeDependencies`, payload);
  }

  /** Set or change the parent of a task. */
  async setTaskParent(taskGid: string, payload: SetAsanaParentRequest): Promise<AxiosResponse> {
    return this.httpClient.post(`/tasks/${taskGid}/setParent`, payload);
  }

  /** Move a task into a project section. */
  async addTaskToSection(sectionGid: string, payload: AddAsanaTaskToSectionRequest): Promise<AxiosResponse> {
    return this.httpClient.post(`/sections/${sectionGid}/addTask`, payload);
  }

  /** Add a task to a project. */
  async addTaskToProject(taskGid: string, payload: AddAsanaTaskToProjectRequest): Promise<AxiosResponse> {
    return this.httpClient.post(`/tasks/${taskGid}/addProject`, payload);
  }

  /** Add a tag to a task. */
  async addTagToTask(taskGid: string, payload: AddAsanaTagToTaskRequest): Promise<AxiosResponse> {
    return this.httpClient.post(`/tasks/${taskGid}/addTag`, payload);
  }

  /** Remove a tag from a task. */
  async removeTagFromTask(taskGid: string, payload: RemoveAsanaTagFromTaskRequest): Promise<AxiosResponse> {
    return this.httpClient.post(`/tasks/${taskGid}/removeTag`, payload);
  }

  /** Fetch paginated project memberships (users and teams) for the configured project. */
  async getProjectMembershipsForProject(
    params?: GetAsanaProjectMembershipsRequest
  ): Promise<AxiosResponse<GetAsanaProjectMembershipsResponse>> {
    return this.httpClient.get(`/memberships`, {
      params: {
        parent: this.projectId,
        member_type: 'user,team',
        limit: ASANA_PAGE_LIMIT,
        opt_fields: 'access_level,member,member.gid,member.name,member.resource_type',
        ...params,
      },
    });
  }

  /** Fetch paginated teams for the configured workspace. */
  async getTeamsForWorkspace(
    params?: GetAsanaTeamsRequest
  ): Promise<AxiosResponse<GetAsanaTeamsResponse>> {
    return this.httpClient.get(`/workspaces/${this.workspaceId}/teams`, {
      params: {
        limit: ASANA_PAGE_LIMIT,
        opt_fields: 'name,description',
        ...params,
      },
    });
  }

  /** Fetch paginated team memberships for a given team. */
  async getTeamMembershipsForTeam(
    teamGid: string,
    params?: GetAsanaTeamMembershipsRequest
  ): Promise<AxiosResponse<GetAsanaTeamMembershipsResponse>> {
    return this.httpClient.get(`/teams/${teamGid}/team_memberships`, {
      params: {
        limit: ASANA_PAGE_LIMIT,
        opt_fields: 'user,user.gid,user.name,user.email',
        ...params,
      },
    });
  }

  /** Upload a file attachment to a task. */
  async createTaskAttachment(parentGid: string, fileBuffer: Buffer, fileName: string): Promise<AxiosResponse> {
    const FormData = (await import('form-data')).default;
    const form = new FormData();
    form.append('parent', parentGid);
    form.append('file', fileBuffer, { filename: fileName });

    return this.httpClient.post('/attachments', form, {
      headers: form.getHeaders(),
    });
  }

}
