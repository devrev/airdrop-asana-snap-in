// Denormalization functions transform a normalized object into a format suitable for external system 
// API requests, typically for creating or updating. It structures the object data to adhere to the expected 
// payload shape of external system requests, extracting relevant properties (such as the assignee, name, and notes). 

export function denormalizeTask(item: any, projectId?: string) {
  return {
    data: {
      assignee: item.data?.assignee?.external,
      name: item.data?.name || '',
      notes: item.data?.description?.content?.[0] ? item.data?.description?.content?.[0] : '',
      ...(projectId && { projects: [projectId] }),
    },
  };
}
