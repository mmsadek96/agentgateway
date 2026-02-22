import { Decimal } from '@prisma/client/runtime/library';
import prisma from '../../db/prisma';
import {
  calculateReputationScore,
  updateAgentReputation,
} from '../reputation';

// Mock the entire prisma module
jest.mock('../../db/prisma', () => ({
  __esModule: true,
  default: {
    agent: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    reputationEvent: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

describe('Reputation Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const createMockAgent = (overrides = {}) => ({
    id: 'test-agent-id',
    address: '0x1234567890123456789012345678901234567890',
    name: 'Test Agent',
    identityVerified: false,
    stakeAmount: new Decimal(0),
    totalActions: 0,
    successfulActions: 0,
    failedActions: 0,
    reputationScore: 50,
    createdAt: new Date(),
    updatedAt: new Date(),
    vouchesReceived: [],
    ...overrides,
  });

  describe('calculateReputationScore', () => {
    it('should throw error if agent not found', async () => {
      (prisma.agent.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(calculateReputationScore('non-existent')).rejects.toThrow(
        'Agent not found'
      );
    });

    it('should calculate base score correctly for new agent', async () => {
      const mockAgent = createMockAgent();
      (prisma.agent.findUnique as jest.Mock).mockResolvedValue(mockAgent);

      const result = await calculateReputationScore(mockAgent.id);

      expect(result).toEqual({
        baseScore: 50,
        identityBonus: 0,
        stakeBonus: 0,
        vouchBonus: 0,
        successRateBonus: 0,
        ageBonus: 0,
        failurePenalty: 0,
        totalScore: 50,
      });
    });

    it('should apply identity bonus correctly', async () => {
      const mockAgent = createMockAgent({ identityVerified: true });
      (prisma.agent.findUnique as jest.Mock).mockResolvedValue(mockAgent);

      const result = await calculateReputationScore(mockAgent.id);

      expect(result.identityBonus).toBe(10);
      expect(result.totalScore).toBe(60);
    });
  });

  describe('updateAgentReputation', () => {
    it('should update agent reputation and return new score', async () => {
      const mockAgent = createMockAgent();
      
      (prisma.agent.findUnique as jest.Mock).mockResolvedValue(mockAgent);
      (prisma.agent.update as jest.Mock).mockResolvedValue({
        ...mockAgent,
        reputationScore: 50,
      });

      const result = await updateAgentReputation(mockAgent.id);

      expect(result).toBe(50);
      expect(prisma.agent.update).toHaveBeenCalledWith({
        where: { id: mockAgent.id },
        data: { reputationScore: 50 },
      });
    });
  });
});