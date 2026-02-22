import { PrismaClient } from '.prisma/client';
import { mockDeep, mockReset } from 'jest-mock-extended';

// Mock Prisma
jest.mock('../db/prisma', () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));

import prisma from '../db/prisma';

beforeEach(() => {
  mockReset(prisma);
});

afterAll(async () => {
  jest.clearAllMocks();
});