# Contributing to AgentTrust

First off, thank you for considering contributing! AgentTrust is building the trust infrastructure for the AI agent economy, and every contribution helps.

## Ways to Contribute

### For Everyone
- **Star the repo** — It helps more people discover AgentTrust
- **Report bugs** — Open an issue with reproduction steps
- **Suggest features** — We want to hear your ideas
- **Improve docs** — Typos, clarity, examples — all welcome

### For Developers
- **Fix bugs** — Check issues labeled `bug`
- **Build features** — Check issues labeled `good first issue` or `help wanted`
- **Write SDKs** — We need SDKs for Python, Go, Rust, and more
- **Add tests** — Increase coverage (API tests, gateway tests, contract tests)
- **Improve the gateway** — New middleware features, better error handling
- **Smart contracts** — Write Hardhat tests, improve gas efficiency, build on-chain verifier tools
- **Blockchain tooling** — BaseScan verification scripts, batch sync improvements, gas monitoring

## Getting Started

Contributions focus on the open-source components: **gateway middleware**, **agent SDK**, **behavioral detection algorithms**, and **smart contracts**. The Station (central API) is hosted by AgentTrust.

### Prerequisites
- Node.js >= 18
- npm

### Setup

```bash
# Fork and clone
git clone https://github.com/YOUR_USERNAME/agentgateway.git
cd agentgateway

# Install dependencies
npm install

# Work on the component you're contributing to:
cd packages/gateway      # Gateway middleware
cd packages/agent-sdk    # Agent SDK
cd contracts             # Smart contracts (needs Hardhat)
```

### Project Structure

```
agentgateway/
├── packages/
│   ├── gateway/            # @agent-trust/gateway (Express middleware) ← CONTRIBUTE HERE
│   └── agent-sdk/          # @agent-trust/sdk (Agent client library)  ← CONTRIBUTE HERE
├── contracts/              # Solidity smart contracts (Base L2)       ← CONTRIBUTE HERE
│   ├── contracts/          # AgentRegistry, CertificateRegistry, ReputationLedger
│   └── scripts/            # Deployment scripts
├── src/                    # Station server (hosted by AgentTrust)
│   ├── routes/             # API endpoints
│   ├── services/           # Business logic (+ blockchain.ts)
│   ├── middleware/          # Auth, rate limiting
│   └── public/             # Landing page + dashboard
├── examples/               # Demo scripts
└── prisma/                 # Database schema
```

## Development Workflow

1. **Create a branch** from `main`:
   ```bash
   git checkout -b feature/my-awesome-feature
   ```

2. **Make your changes** — follow the existing code style

3. **Test your changes** — make sure the server starts and endpoints work

4. **Commit with a descriptive message**:
   ```bash
   git commit -m "Add webhook support for trust events"
   ```

5. **Push and open a PR**:
   ```bash
   git push origin feature/my-awesome-feature
   ```

## Code Style

- TypeScript for all new code
- Use `async/await` over callbacks
- Error handling: always return `{ success: false, error: "..." }` format
- Keep functions small and focused
- Add JSDoc comments for public APIs

## Pull Request Guidelines

- **Keep PRs focused** — one feature or fix per PR
- **Describe what and why** — not just what changed, but why
- **Reference issues** — link to related issues
- **Update docs** — if your change affects the API or setup

## Ideas for Contributions

Here are some high-impact areas where we need help:

| Area | Difficulty | Impact |
|------|-----------|--------|
| Python SDK | Medium | High |
| Test suite | Medium | High |
| Webhook system | Medium | High |
| Rate limiting by trust tier | Medium | High |
| Web dashboard UI | Hard | Very High |
| Go SDK | Medium | Medium |
| CI/CD pipeline | Easy | Medium |
| Smart contract tests (Hardhat) | Medium | High |
| BaseScan contract verification | Easy | Medium |
| On-chain verifier SDK | Hard | Very High |
| Batch sync service (cron) | Medium | High |
| Multisig migration for contracts | Hard | High |

## Questions?

Open an issue with the `question` label, or start a discussion. We're friendly!

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
