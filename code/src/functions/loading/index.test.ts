import { spawn } from '@devrev/ts-adaas';

import run, { initialLoaderState } from './index';

jest.mock('@devrev/ts-adaas', () => ({
  spawn: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@asana/initial_domain_mapping.json', () => ({ record_types: {} }), { virtual: true });

const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;

describe('loading/index', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('initialLoaderState', () => {
    it('should export an empty initial state', () => {
      expect(initialLoaderState).toEqual({});
    });
  });

  describe('run', () => {
    it('should call spawn for each event', async () => {
      const events = [
        { payload: { connection_data: {}, event_context: {} } },
        { payload: { connection_data: {}, event_context: {} } },
      ] as any[];

      await run(events);

      expect(mockSpawn).toHaveBeenCalledTimes(2);
    });

    it('should pass correct config to spawn', async () => {
      const event = { payload: { connection_data: {}, event_context: {} } } as any;

      await run([event]);

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.objectContaining({
          event,
          initialState: initialLoaderState,
          initialDomainMapping: expect.any(Object),
        })
      );
    });

    it('should handle empty events array', async () => {
      await run([]);

      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('should process events sequentially', async () => {
      const callOrder: number[] = [];
      mockSpawn.mockImplementation(async () => {
        callOrder.push(callOrder.length + 1);
        return undefined as any;
      });

      const events = [
        { payload: { connection_data: {}, event_context: {} } },
        { payload: { connection_data: {}, event_context: {} } },
        { payload: { connection_data: {}, event_context: {} } },
      ] as any[];

      await run(events);

      expect(callOrder).toEqual([1, 2, 3]);
    });
  });
});
