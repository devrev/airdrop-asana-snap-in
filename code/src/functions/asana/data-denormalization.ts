// Denormalization functions transform a normalized object into a format suitable for external system 
// API requests, typically for creating or updating. It structures the object data to adhere to the expected 
// payload shape of external system requests, extracting relevant properties (such as the assignee, name, and notes). 

export function denormalizeTask(item: any, projectId?: string) {
  const data: any = {};

  if (item.data?.name != null) {
    data.name = item.data?.name || '';
  }

  if (item.data?.assignee != null) {
    if ('external' in item.data.assignee) {
      data.assignee = item.data.assignee.external;
    } else {
      data.assignee = null;
      console.warn(`Given DevRev user (${item.data.assignee.devrev}) does not exist in Asana.`);
    }
  }

  if (item.data?.description != null) {
    data.notes = item.data?.description?.content?.[0] || '';
  }
  
  if (projectId != null) {
    data.projects = [projectId];
  }

  return { data };
}
