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
- **Add tests** — Increase coverage
- **Improve the gateway** — New middleware features, better error handling

## Getting Started

### Prerequisites
- Node.js >= 18
- PostgreSQL
- npm

### Setup

```bash
# Fork and clone
git clone https://github.com/YOUR_USERNAME/agentgateway.git
cd agentgateway

# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your database URL

# Generate RSA keys
npm run generate-keys
# Copy output to .env

# Push database schema
npx prisma db push

# Start development server
npm run dev
```

### Project Structure

```
agentgateway/
├── src/                    # Station server
│   ├── routes/             # API endpoints
│   ├── services/           # Business logic (+ blockchain.ts)
│   ├── middleware/          # Auth, rate limiting
│   ├── utils/              # Helpers (keys, etc.)
│   ├── types/              # TypeScript interfaces
│   └── public/             # Landing page + dashboard
├── contracts/              # Solidity smart contracts (Base L2)
│   ├── contracts/          # AgentRegistry, CertificateRegistry, ReputationLedger
│   └── scripts/            # Deployment scripts
├── packages/
│   ├── gateway/            # @agent-trust/gateway (Express middleware)
│   └── agent-sdk/          # @agent-trust/sdk (Agent client library)
├── examples/               # Demo scripts
├── prisma/                 # Database schema
└── Dockerfile              # Production container
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
| Docker Compose for local dev | Easy | Medium |
| Webhook system | Medium | High |
| Rate limiting by trust tier | Medium | High |
| Web dashboard UI | Hard | Very High |
| Go SDK | Medium | Medium |
| CI/CD pipeline | Easy | Medium |

## Questions?

Open an issue with the `question` label, or start a discussion. We're friendly!

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
