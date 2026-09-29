import externalDomainMetadata from './external_domain_metadata.json';

// Guards the reference contract that keeps the task/subtask hierarchy intact after forward sync.
// A subtask's parent can itself be a subtask, so parent_task must resolve to both record types;
// otherwise the required reference fails and the subtask is dropped with an empty Parent Task.
describe('external_domain_metadata parent_task references', () => {
  const recordTypes = (externalDomainMetadata as { record_types: Record<string, { fields: Record<string, { reference?: { refers_to?: Record<string, unknown> } }> }> }).record_types;

  it.each(['tasks', 'subtasks'])('%s.parent_task refers to both tasks and subtasks', (recordType) => {
    const refersTo = recordTypes[recordType].fields.parent_task.reference?.refers_to ?? {};

    expect(Object.keys(refersTo).sort()).toEqual(['#record:subtasks', '#record:tasks']);
  });
});
