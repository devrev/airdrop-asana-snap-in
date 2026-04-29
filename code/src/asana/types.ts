import { LinkTypeValue } from '@asana/constants';

import {
  AddDependenciesForTaskRequest,
  AddProjectForTaskRequest,
  AddTagForTaskRequest,
  AddTaskForSectionRequest,
  AttachmentCompact,
  CreateTask201Response,
  CreateTaskRequest,
  CustomFieldResponse,
  CustomFieldSettingResponse,
  EnumOption,
  GetTaskCountsForProject200Response,
  MembershipCompact,
  NextPage,
  ProjectMembershipCompact,
  ProjectResponse,
  RemoveTagForTaskRequest,
  SectionResponse,
  SetParentForTaskRequest,
  StoryBase,
  StoryResponse,
  TagResponse,
  TaskBaseAllOfMemberships,
  TaskResponse,
  TeamCompact,
  TeamMembershipCompact,
  UserResponse,
} from './api-client/generated';

export type AsanaProject = ProjectResponse;
export type AsanaStory = StoryResponse;
export type AsanaSection = SectionResponse;
export type AsanaTag = TagResponse;
export type AsanaUser = UserResponse;
export type AsanaCustomField = CustomFieldResponse;
export type AsanaEnumOption = EnumOption;
export type AsanaTaskMembership = TaskBaseAllOfMemberships;
export type AsanaTask = TaskResponse & {
  attachments?: AttachmentCompact[];
};

export type { NextPage };

export interface ListResponse<T> {
  data: T[];
  next_page: NextPage | null;
}

export interface PaginatedRequest {
  offset?: string;
}

export interface PaginatedRequestWithLimit extends PaginatedRequest {
  limit?: number;
}

export type GetAsanaTasksRequest = PaginatedRequestWithLimit;
export type GetAsanaSubtasksRequest = PaginatedRequestWithLimit;
export type GetAsanaProjectsRequest = PaginatedRequestWithLimit;
export type GetAsanaTagsRequest = PaginatedRequestWithLimit;
export type GetAsanaCustomFieldSettingsRequest = PaginatedRequestWithLimit;
export type GetAsanaStoriesRequest = PaginatedRequestWithLimit;
export type GetAsanaSectionsRequest = PaginatedRequestWithLimit;
export type GetAsanaMembershipsRequest = PaginatedRequest;

export type GetAsanaTasksResponse = ListResponse<AsanaTask>;
export type GetAsanaSubtasksResponse = ListResponse<AsanaTask>;
export type GetAsanaProjectsResponse = ListResponse<AsanaProject>;
export type GetAsanaProjectTaskCountResponse = GetTaskCountsForProject200Response;
export type AsanaMembership = MembershipCompact;
export type GetAsanaMembershipsResponse = ListResponse<AsanaMembership>;
export type GetAsanaUserResponse = { data: AsanaUser };
export type GetAsanaTagsResponse = ListResponse<AsanaTag>;
export type AsanaCustomFieldSetting = CustomFieldSettingResponse;
export type GetAsanaCustomFieldSettingsResponse = ListResponse<AsanaCustomFieldSetting>;
export type GetAsanaUsersResponse = ListResponse<AsanaUser>;
export type GetAsanaStoriesResponse = ListResponse<AsanaStory>;
export type GetAsanaSectionsResponse = ListResponse<AsanaSection>;

export type AsanaAttachment = {
  gid?: string;
  download_url?: string;
  name?: string;
  parent_id?: string;
  inline?: boolean;
  created_at?: string;
};

export type AsanaLink = {
  gid?: string;
  link_type: LinkTypeValue;
  source_gid: string;
  target_gid: string;
};

export type GetAsanaProjectResponse = { data: AsanaProject };

export type CreateAsanaTaskRequest = CreateTaskRequest;
export type UpdateAsanaTaskRequest = CreateTaskRequest;
export type CreateAsanaTaskResponse = CreateTask201Response;

export type CreateAsanaCommentRequest = { data?: StoryBase };

export type AddAsanaDependenciesRequest = AddDependenciesForTaskRequest;
export type SetAsanaParentRequest = SetParentForTaskRequest;
export type AddAsanaTaskToSectionRequest = AddTaskForSectionRequest;
export type AddAsanaTaskToProjectRequest = AddProjectForTaskRequest;
export type AddAsanaTagToTaskRequest = AddTagForTaskRequest;
export type RemoveAsanaTagFromTaskRequest = RemoveTagForTaskRequest;

export type AsanaProjectMembership = ProjectMembershipCompact;
export type AsanaTeamMembership = TeamMembershipCompact;
export type AsanaTeam = TeamCompact;

export type AsanaAccessRulePrivilege = 'create' | 'read' | 'update' | 'delete';

export type GetAsanaProjectMembershipsRequest = PaginatedRequest;
export type GetAsanaProjectMembershipsResponse = ListResponse<AsanaProjectMembership>;
export type GetAsanaTeamMembershipsRequest = PaginatedRequest;
export type GetAsanaTeamMembershipsResponse = ListResponse<AsanaTeamMembership>;
export type GetAsanaTeamsRequest = PaginatedRequestWithLimit;
export type GetAsanaTeamsResponse = ListResponse<AsanaTeam>;
