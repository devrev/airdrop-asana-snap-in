import { axiosClient, ExternalSystemAttachment } from '@devrev/ts-adaas';
import { AxiosResponse } from 'axios';

import { AirdropEvent } from '@devrev/ts-adaas';
import { ApiParams } from './types';

export class AsanaClient {
  private apiBase: string = 'https://app.asana.com/api/1.0';
  private apiKey: string;
  private orgId: string;
  private defaultHeaders: any;
  public projectId: string;

  constructor(event: AirdropEvent) {
    this.apiKey = event.payload.connection_data.key;
    this.orgId = event.payload.connection_data.org_id; // workspace id
    this.projectId = event.payload.event_context.external_sync_unit_id;
    this.defaultHeaders = {
      authorization: `Bearer ${this.apiKey}`,
    };
  }

  async getTasks(params: ApiParams): Promise<AxiosResponse> {
    const url = `${this.apiBase}/projects/${this.projectId}/tasks`;

    return axiosClient.get(url, {
      headers: {
        ...this.defaultHeaders,
      },
      params: {
        ...params,
        opt_fields:
          'name,created_at,modified_at,assignee,attachments.name,attachments.size,attachments.download_url,html_notes',
      },
    });
  }

  async createTask(body: any): Promise<AxiosResponse> {
    const url = `https://app.asana.com/api/1.0/tasks`;

    return axiosClient.post(url, body, {
      headers: {
        ...this.defaultHeaders,
      },
    });
  }

  async updateTask(taskId: string, body: any): Promise<AxiosResponse> {
    const url = `https://app.asana.com/api/1.0/tasks/${taskId}`;

    return axiosClient.put(url, body, {
      headers: {
        ...this.defaultHeaders,
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
    const url = `${this.apiBase}/users`;

    return axiosClient.get(url, {
      headers: {
        ...this.defaultHeaders,
      },
      params: {
        ...params,
        workspace: this.orgId,
        opt_fields: 'name,email',
      },
    });
  }

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
}
