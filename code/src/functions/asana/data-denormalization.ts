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
