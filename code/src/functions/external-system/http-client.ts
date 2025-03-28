import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';

import {
  AirdropEvent,
  ExternalSystemItem,
  ExternalSystemItemLoadingParams,
  ExternalSystemItemLoadingResponse,
} from '@devrev/ts-adaas';

export class HttpClient {
  private apiEndpoint: string;
  private apiToken;
  private defaultHeaders: AxiosRequestConfig['headers'];

  constructor(event: AirdropEvent) {
    this.apiEndpoint = 'https://dummy-api.com'; // Replace with the actual external system API endpoint
    this.apiToken = event.payload.connection_data.key;
    this.defaultHeaders = {
      Authorization: this.apiToken, // Replace with the actual authorization header
    };
  }

  async createIssue({
    item,
    mappers,
    event,
  }: ExternalSystemItemLoadingParams<ExternalSystemItem>): Promise<ExternalSystemItemLoadingResponse> {
    return { error: 'Could not create an issue in external system.' };
  }

  async updateIssue({
    item,
    mappers,
    event,
  }: ExternalSystemItemLoadingParams<ExternalSystemItem>): Promise<ExternalSystemItemLoadingResponse> {
    return { error: 'Could not update an issue in external system.' };
  }
}
