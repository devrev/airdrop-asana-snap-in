import { AirdropEvent, axiosClient, ExternalSystemAttachment } from '@devrev/ts-adaas';
import { AxiosResponse } from 'axios';

type ApiParams = {
  offset?: string;
};

export class AsanaClient {
  private apiBase: string = 'https://app.asana.com/api/1.0';
  private apiKey: string;
  private orgId: string;
  private defaultHeaders: any;
  public projectId: string;

  constructor(event: AirdropEvent) {
    // Keyring credentials for connecting to API can be found in event.payload.connection_data.
    this.apiKey = event.payload.connection_data.key;
    this.orgId = event.payload.connection_data.org_id; // Asana workspace ID
    this.projectId = event.payload.event_context.external_sync_unit_id;
    this.defaultHeaders = {
      authorization: `Bearer ${this.apiKey}`,
    };
  }

  /*** EXTRACTION ENDPOINTS ***/

  async getTasks(params: ApiParams): Promise<AxiosResponse> {
    // Create the URL for the Asana API endpoint to get tasks.
    const url = `${this.apiBase}/projects/${this.projectId}/tasks`;

    // Define the number of tasks to retrieve per page.
    const TASKS_LIMIT = 100;

    // Get data about tasks:
    // - name
    // - description (html_notes)
    // - created_at
    // - modified_at
    // - assignee
    // - attachments
    const TASKS_FIELDS =
      'name,created_at,modified_at,assignee,attachments.name,attachments.size,attachments.download_url,html_notes';

    return axiosClient.get(url, {
      headers: {
        ...this.defaultHeaders,
      },
      params: {
        limit: TASKS_LIMIT,
        opt_fields: TASKS_FIELDS,
        ...params,
      },
    });
  }

  async getProjects(): Promise<AxiosResponse> {
    const url = `${this.apiBase}/workspaces/${this.orgId}/projects`;

    return axiosClient.get(url, {
      headers: {
        ...this.defaultHeaders,
      },
    });
  }

  async getProjectTaskCount(projectId: string): Promise<AxiosResponse> {
    const url = `${this.apiBase}/projects/${projectId}/task_counts?opt_fields=num_tasks`;

    return axiosClient.get(url, {
      headers: {
        ...this.defaultHeaders,
      },
    });
  }

  async getUsers(params: ApiParams): Promise<AxiosResponse> {
    // Create the URL for the Asana API endpoint to get tasks.
    const url = `${this.apiBase}/users`;

    // Define the number of tasks to retrieve per page.
    const USERS_LIMIT = 100;

    return axiosClient.get(url, {
      headers: {
        ...this.defaultHeaders,
      },
      params: {
        limit: USERS_LIMIT,
        workspace: this.orgId,
        opt_fields: 'name,email',
        ...params,
      },
    });
  }

  // Create a new attachment in Asana from the item url.
  async createAttachment(item: ExternalSystemAttachment, taskId: string): Promise<AxiosResponse> {
    const url = `${this.apiBase}/attachments`;

    const form = new FormData();
    form.append('resource_subtype', 'external');
    form.append('parent', taskId);
    form.append('url', item.url);
    form.append('name', item.file_name);
    form.append('connect_to_app', 'true');
    form.append(
      'opt_fields',
      'connected_to_app,created_at,download_url,host,name,parent,parent.created_by,parent.name,parent.resource_subtype,permanent_url,resource_subtype,size,view_url'
    );

    return axiosClient.post(url, form, {
      headers: {
        ...this.defaultHeaders,
        'Content-Type': 'multipart/form-data',
        Accept: 'application/json',
      },
    });
  }

  /*** LOADER ENDPOINTS ***/

  async createTask(body: any): Promise<AxiosResponse> {
    const url = `${this.apiBase}/tasks`;

    return axiosClient.post(url, body, {
      headers: {
        ...this.defaultHeaders,
      },
    });
  }

  async updateTask(taskId: string, body: any): Promise<AxiosResponse> {
    const url = `${this.apiBase}/tasks/${taskId}`;

    return axiosClient.put(url, body, {
      headers: {
        ...this.defaultHeaders,
      },
    });
  }
}
