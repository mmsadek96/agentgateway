import swaggerJsdoc from 'swagger-jsdoc';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'AgentTrust API',
      version: '1.0.0',
      description: 'The blockchain-backed trust layer for the AI agent economy. Reputation scoring, vouching, and cryptographic certificates for AI agents — recorded on Base L2.',
    },
    servers: [
      {
        url: 'https://agentgateway-6f041c655eb3.herokuapp.com',
        description: 'Production server',
      },
      {
        url: 'http://localhost:3000',
        description: 'Development server',
      },
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'API key obtained from /developers/register',
        },
      },
    },
    tags: [
      { name: 'Developers', description: 'Developer registration and management' },
      { name: 'Verification', description: 'Core trust verification endpoints' },
      { name: 'Agents', description: 'Agent management, reputation, staking, vouching' },
    ],
    paths: {
      '/health': {
        get: {
          summary: 'Health check',
          tags: ['System'],
          responses: {
            200: {
              description: 'Service is healthy',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      status: { type: 'string', example: 'ok' },
                      timestamp: { type: 'string', example: '2026-02-02T22:51:31.469Z' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/developers/register': {
        post: {
          summary: 'Register a new developer account',
          tags: ['Developers'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['email', 'companyName'],
                  properties: {
                    email: { type: 'string', example: 'dev@company.com' },
                    companyName: { type: 'string', example: 'My Company' },
                  },
                },
              },
            },
          },
          responses: {
            201: {
              description: 'Developer registered successfully',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: true },
                      data: {
                        type: 'object',
                        properties: {
                          id: { type: 'string' },
                          email: { type: 'string' },
                          companyName: { type: 'string' },
                          plan: { type: 'string', example: 'free' },
                          apiKey: { type: 'string', description: 'Save this! Only shown once.' },
                          createdAt: { type: 'string' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/developers/dashboard': {
        get: {
          summary: 'Get developer dashboard with stats',
          tags: ['Developers'],
          security: [{ BearerAuth: [] }],
          responses: {
            200: {
              description: 'Dashboard data',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean' },
                      data: {
                        type: 'object',
                        properties: {
                          developer: { type: 'object' },
                          stats: {
                            type: 'object',
                            properties: {
                              totalAgents: { type: 'number' },
                              activeAgents: { type: 'number' },
                              totalActions: { type: 'number' },
                              actionsLast24Hours: { type: 'number' },
                              averageReputationScore: { type: 'number' },
                            },
                          },
                          agents: { type: 'array' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/developers/agents': {
        post: {
          summary: 'Register a new agent',
          tags: ['Developers'],
          security: [{ BearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['externalId'],
                  properties: {
                    externalId: { type: 'string', example: 'agent-001', description: 'Your unique identifier for this agent' },
                  },
                },
              },
            },
          },
          responses: {
            201: {
              description: 'Agent registered',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean' },
                      data: {
                        type: 'object',
                        properties: {
                          id: { type: 'string' },
                          externalId: { type: 'string' },
                          reputationScore: { type: 'number', example: 50 },
                          status: { type: 'string', example: 'active' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        get: {
          summary: 'List all agents',
          tags: ['Developers'],
          security: [{ BearerAuth: [] }],
          responses: {
            200: { description: 'List of agents' },
          },
        },
      },
      '/verify': {
        post: {
          summary: 'Verify if an agent should be trusted for an action',
          description: 'The core endpoint. Call this before allowing an agent to perform sensitive actions.',
          tags: ['Verification'],
          security: [{ BearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['agentId', 'actionType'],
                  properties: {
                    agentId: { type: 'string', example: 'agent-001' },
                    actionType: { type: 'string', example: 'place_order' },
                    threshold: { type: 'number', example: 50, description: 'Minimum score required (default: 50)' },
                    context: { type: 'object', description: 'Optional metadata about the action' },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: 'Verification result',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean' },
                      data: {
                        type: 'object',
                        properties: {
                          allowed: { type: 'boolean', description: 'Whether the action should be allowed' },
                          score: { type: 'number', description: 'Current reputation score (0-100)' },
                          reason: { type: 'string', description: 'Human-readable explanation' },
                          actionId: { type: 'string', description: 'Use this to report outcome later' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/report': {
        post: {
          summary: 'Report the outcome of an action',
          description: 'Call this after an action completes to update the agent reputation.',
          tags: ['Verification'],
          security: [{ BearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['actionId', 'outcome'],
                  properties: {
                    actionId: { type: 'string', description: 'From the /verify response' },
                    outcome: { type: 'string', enum: ['success', 'failure'] },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: 'Outcome recorded',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean' },
                      data: {
                        type: 'object',
                        properties: {
                          updated: { type: 'boolean' },
                          newScore: { type: 'number' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/agents/{agentId}/reputation': {
        get: {
          summary: 'Get detailed reputation breakdown',
          tags: ['Agents'],
          security: [{ BearerAuth: [] }],
          parameters: [
            { name: 'agentId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            200: {
              description: 'Reputation details',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean' },
                      data: {
                        type: 'object',
                        properties: {
                          agentId: { type: 'string' },
                          currentScore: { type: 'number' },
                          factors: {
                            type: 'object',
                            properties: {
                              base: { type: 'number', example: 50 },
                              identityVerified: { type: 'number', example: 10 },
                              stake: { type: 'number', example: 10 },
                              vouches: { type: 'number', example: 4 },
                              successRate: { type: 'number', example: 20 },
                              accountAge: { type: 'number', example: 2 },
                              failurePenalty: { type: 'number', example: -5 },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/agents/{agentId}/stake': {
        post: {
          summary: 'Add stake/collateral for an agent',
          tags: ['Agents'],
          security: [{ BearerAuth: [] }],
          parameters: [
            { name: 'agentId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['amount'],
                  properties: {
                    amount: { type: 'number', example: 100, description: 'Amount to stake' },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'Stake added' },
          },
        },
        get: {
          summary: 'Get stake info',
          tags: ['Agents'],
          security: [{ BearerAuth: [] }],
          parameters: [
            { name: 'agentId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            200: { description: 'Stake info' },
          },
        },
      },
      '/agents/{agentId}/vouch': {
        post: {
          summary: 'Vouch for another agent',
          description: 'The vouching agent must have a reputation score of at least 60.',
          tags: ['Agents'],
          security: [{ BearerAuth: [] }],
          parameters: [
            { name: 'agentId', in: 'path', required: true, schema: { type: 'string' }, description: 'The agent doing the vouching' },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['targetAgentId'],
                  properties: {
                    targetAgentId: { type: 'string', description: 'Agent to vouch for' },
                    weight: { type: 'number', example: 1, description: 'Vouch weight (1-5)' },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'Vouch created' },
          },
        },
      },
      '/agents/{agentId}/verify-identity': {
        post: {
          summary: 'Mark agent as identity verified',
          tags: ['Agents'],
          security: [{ BearerAuth: [] }],
          parameters: [
            { name: 'agentId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            200: { description: 'Identity verified' },
          },
        },
      },
    },
  },
  apis: [],
};

export const swaggerSpec = swaggerJsdoc(options);
