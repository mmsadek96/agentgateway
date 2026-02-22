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
        description: 'AgentTrust Station',
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
      { name: 'Token & Staking', description: '$TRUST token operations and liquid staking' },
      { name: 'Reputation Markets', description: 'Binary options on agent reputation scores' },
      { name: 'Insurance', description: 'Agent performance insurance (CDS)' },
      { name: 'Vouch NFTs', description: 'ERC-721 tradable vouch NFTs' },
      { name: 'Governance', description: 'DAO governance and DeFi ecosystem overview' },
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

      // ─── Token & Staking ───
      '/trust/stats': {
        get: {
          summary: 'Get $TRUST token statistics',
          description: 'Returns total supply, mintable supply from the on-chain TrustToken contract.',
          tags: ['Token & Staking'],
          responses: {
            200: {
              description: 'Token stats',
              content: { 'application/json': { schema: { type: 'object', properties: {
                success: { type: 'boolean' },
                data: { type: 'object', properties: {
                  totalSupply: { type: 'string', example: '100000000.0' },
                  mintable: { type: 'string', example: '900000000.0' },
                }},
              }}}},
            },
          },
        },
      },
      '/trust/balance/{agentId}': {
        get: {
          summary: 'Get $TRUST + stTRUST balance for an agent',
          tags: ['Token & Staking'],
          parameters: [
            { name: 'agentId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            200: { description: 'Token balance' },
          },
        },
      },
      '/trust/stake': {
        post: {
          summary: 'Stake $TRUST tokens for an agent',
          description: 'Stakes $TRUST into the StakingVault. Agent receives stTRUST (liquid receipt) and a reputation bonus (0-15).',
          tags: ['Token & Staking'],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['agentId', 'amount'], properties: {
            agentId: { type: 'string', description: 'Agent UUID' },
            amount: { type: 'string', example: '1000', description: 'Amount of $TRUST to stake' },
          }}}}},
          responses: {
            200: { description: 'Stake transaction submitted', content: { 'application/json': { schema: { type: 'object', properties: {
              success: { type: 'boolean' },
              data: { type: 'object', properties: { txHash: { type: 'string' } }},
            }}}}},
          },
        },
      },
      '/trust/unstake/request': {
        post: {
          summary: 'Request unstake with 7-day cooldown',
          tags: ['Token & Staking'],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['agentId', 'amount'], properties: {
            agentId: { type: 'string' },
            amount: { type: 'string', example: '500' },
          }}}}},
          responses: { 200: { description: 'Unstake request submitted' } },
        },
      },
      '/trust/unstake/complete': {
        post: {
          summary: 'Complete unstake after cooldown period',
          tags: ['Token & Staking'],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['agentId'], properties: {
            agentId: { type: 'string' },
          }}}}},
          responses: { 200: { description: 'Unstake completed, $TRUST returned' } },
        },
      },
      '/trust/stake/{agentId}': {
        get: {
          summary: 'Get staking info for an agent',
          description: 'Returns staked amount, unstake request, cooldown timer, and stake reputation score from the on-chain StakingVault.',
          tags: ['Token & Staking'],
          parameters: [
            { name: 'agentId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            200: { description: 'Staking info', content: { 'application/json': { schema: { type: 'object', properties: {
              success: { type: 'boolean' },
              data: { type: 'object', properties: {
                stakedAmount: { type: 'string' },
                unstakeRequestAmount: { type: 'string' },
                unstakeRequestTime: { type: 'number' },
                unlockTime: { type: 'number' },
                stakeScore: { type: 'number', description: 'Reputation bonus (0-15)' },
              }},
            }}}}},
          },
        },
      },
      '/trust/staking/stats': {
        get: {
          summary: 'Get global staking statistics',
          tags: ['Token & Staking'],
          responses: {
            200: { description: 'Staking stats', content: { 'application/json': { schema: { type: 'object', properties: {
              success: { type: 'boolean' },
              data: { type: 'object', properties: {
                totalStaked: { type: 'string' },
                cooldownPeriod: { type: 'number' },
              }},
            }}}}},
          },
        },
      },

      // ─── Reputation Markets ───
      '/markets/stats': {
        get: {
          summary: 'Get reputation market statistics',
          tags: ['Reputation Markets'],
          responses: {
            200: { description: 'Market stats', content: { 'application/json': { schema: { type: 'object', properties: {
              success: { type: 'boolean' },
              data: { type: 'object', properties: {
                totalMarkets: { type: 'number' },
                totalVolume: { type: 'string' },
                nextMarketId: { type: 'number' },
              }},
            }}}}},
          },
        },
      },
      '/markets/{id}': {
        get: {
          summary: 'Get market details',
          tags: ['Reputation Markets'],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'number' } },
          ],
          responses: {
            200: { description: 'Market details with pools, outcome, and settlement status' },
          },
        },
      },
      '/markets/create': {
        post: {
          summary: 'Create a reputation prediction market',
          description: 'Creates a binary options market: "Will agent X have score >= Y by time Z?"',
          tags: ['Reputation Markets'],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['agentId', 'targetScore', 'expiresAt'], properties: {
            agentId: { type: 'string', description: 'Agent UUID' },
            targetScore: { type: 'number', example: 75, description: 'Target reputation score (0-100)' },
            expiresAt: { type: 'number', description: 'Unix timestamp for market expiry' },
          }}}}},
          responses: { 200: { description: 'Market created' } },
        },
      },
      '/markets/{id}/bet': {
        post: {
          summary: 'Place a bet on a reputation market',
          tags: ['Reputation Markets'],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'number' } },
          ],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['side', 'amount', 'agentId'], properties: {
            side: { type: 'string', enum: ['yes', 'no'], description: 'Bet YES (score will reach target) or NO' },
            amount: { type: 'string', example: '100', description: 'Amount of $TRUST to bet' },
            agentId: { type: 'string', description: 'Bettor agent UUID' },
          }}}}},
          responses: { 200: { description: 'Bet placed' } },
        },
      },
      '/markets/{id}/settle': {
        post: {
          summary: 'Settle an expired market',
          description: 'Reads the agent score from AgentRegistry on-chain and determines outcome.',
          tags: ['Reputation Markets'],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'number' } },
          ],
          responses: { 200: { description: 'Market settled' } },
        },
      },
      '/markets/{id}/claim': {
        post: {
          summary: 'Claim winnings from a settled market',
          tags: ['Reputation Markets'],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'number' } },
          ],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['agentId'], properties: {
            agentId: { type: 'string', description: 'Claimant agent UUID' },
          }}}}},
          responses: { 200: { description: 'Winnings claimed' } },
        },
      },

      // ─── Insurance ───
      '/insurance/stats': {
        get: {
          summary: 'Get insurance pool statistics',
          tags: ['Insurance'],
          responses: {
            200: { description: 'Insurance stats', content: { 'application/json': { schema: { type: 'object', properties: {
              success: { type: 'boolean' },
              data: { type: 'object', properties: {
                totalCollateral: { type: 'string' },
                totalPremiums: { type: 'string' },
                totalPolicies: { type: 'number' },
                totalClaims: { type: 'number' },
              }},
            }}}}},
          },
        },
      },
      '/insurance/collateral/deposit': {
        post: {
          summary: 'Deposit collateral to back agent performance',
          tags: ['Insurance'],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['agentId', 'amount'], properties: {
            agentId: { type: 'string' },
            amount: { type: 'string', example: '5000' },
          }}}}},
          responses: { 200: { description: 'Collateral deposited' } },
        },
      },
      '/insurance/buy': {
        post: {
          summary: 'Buy an insurance policy on an agent',
          description: 'Premium auto-calculated based on agent score and trigger proximity. If agent score drops below trigger, the policy pays out.',
          tags: ['Insurance'],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['agentId', 'coverageAmount', 'triggerScore', 'expiresAt'], properties: {
            agentId: { type: 'string', description: 'Agent to insure' },
            coverageAmount: { type: 'string', example: '10000', description: 'Max payout in $TRUST' },
            triggerScore: { type: 'number', example: 40, description: 'Score threshold that triggers payout (0-100)' },
            expiresAt: { type: 'number', description: 'Unix timestamp for policy expiry' },
          }}}}},
          responses: { 200: { description: 'Insurance policy created' } },
        },
      },
      '/insurance/{id}/claim': {
        post: {
          summary: 'File an insurance claim',
          description: 'Checks if agent score is below trigger. If so, pays out from agent collateral.',
          tags: ['Insurance'],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'number' } },
          ],
          responses: { 200: { description: 'Claim filed and paid out' } },
        },
      },

      // ─── Vouch NFTs ───
      '/vouches/nft/stats': {
        get: {
          summary: 'Get vouch NFT statistics',
          tags: ['Vouch NFTs'],
          responses: {
            200: { description: 'Vouch NFT stats', content: { 'application/json': { schema: { type: 'object', properties: {
              success: { type: 'boolean' },
              data: { type: 'object', properties: {
                totalVouches: { type: 'number' },
                totalActive: { type: 'number' },
              }},
            }}}}},
          },
        },
      },
      '/vouches/nft/mint': {
        post: {
          summary: 'Mint a vouch NFT',
          description: 'Creates an ERC-721 vouch NFT. Voucher must have score >= 60. Voucher reputation is frozen into the NFT at mint time.',
          tags: ['Vouch NFTs'],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['voucherAgentId', 'vouchedAgentId', 'weight'], properties: {
            voucherAgentId: { type: 'string', description: 'Agent doing the vouching' },
            vouchedAgentId: { type: 'string', description: 'Agent being vouched for' },
            weight: { type: 'number', example: 3, description: 'Vouch weight (1-5)' },
          }}}}},
          responses: { 200: { description: 'Vouch NFT minted' } },
        },
      },
      '/vouches/nft/{tokenId}': {
        get: {
          summary: 'Get vouch NFT metadata',
          tags: ['Vouch NFTs'],
          parameters: [
            { name: 'tokenId', in: 'path', required: true, schema: { type: 'number' } },
          ],
          responses: {
            200: { description: 'NFT metadata including voucher, vouchee, weight, and frozen score' },
          },
        },
      },

      // ─── Governance ───
      '/governance/info': {
        get: {
          summary: 'Get DAO governance contract info',
          description: 'Returns governor, timelock, token addresses and voting parameters.',
          tags: ['Governance'],
          responses: {
            200: { description: 'Governance info with voting parameters' },
          },
        },
      },
      '/governance/overview': {
        get: {
          summary: 'Full DeFi ecosystem overview',
          description: 'Returns aggregated stats from all DeFi contracts: token supply, staking TVL, market volume, insurance pool, vouch NFTs.',
          tags: ['Governance'],
          responses: {
            200: { description: 'Complete DeFi overview', content: { 'application/json': { schema: { type: 'object', properties: {
              success: { type: 'boolean' },
              data: { type: 'object', properties: {
                enabled: { type: 'boolean' },
                token: { type: 'object' },
                staking: { type: 'object' },
                markets: { type: 'object' },
                insurance: { type: 'object' },
                vouches: { type: 'object' },
                contracts: { type: 'object' },
              }},
            }}}}},
          },
        },
      },
    },
  },
  apis: [],
};

export const swaggerSpec = swaggerJsdoc(options);
