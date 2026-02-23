# langchain-agenttrust

LangChain integration for the [AgentTrust](https://github.com/anthropics/agenttrust) protocol. This package provides an async Python client and LangChain-compatible tools that let AI agents discover gateways, request clearance certificates, and execute trusted actions.

## Installation

```bash
pip install langchain-agenttrust
```

## Quick Start

```python
import asyncio
from langchain_agenttrust import AgentTrustClient, AgentTrustConfig

config = AgentTrustConfig(
    station_url="https://station.example.com",
    api_key="ats_xxxxx",
    agent_id="my-agent-001",
)

async def main():
    async with AgentTrustClient(config) as client:
        # Discover what a gateway offers
        discovery = await client.discover_gateway(
            "https://shop.example.com/agent-gateway"
        )
        print(discovery.actions)

        # Execute an action
        result = await client.execute_action(
            "https://shop.example.com/agent-gateway",
            "search_products",
            {"query": "blue widgets"},
        )
        print(result.data)

asyncio.run(main())
```

## Available Tools

The package exposes two LangChain tools that can be handed directly to an agent:

### AgentTrustDiscoverTool

Discovers available actions on an AgentTrust gateway. Accepts a gateway URL and returns a formatted listing of actions with descriptions and minimum reputation scores.

```python
from langchain_agenttrust import AgentTrustClient, AgentTrustConfig, AgentTrustDiscoverTool

client = AgentTrustClient(AgentTrustConfig(...))
tool = AgentTrustDiscoverTool(client=client)
```

### AgentTrustActionTool

Executes a trusted action on an AgentTrust gateway. Accepts a gateway URL, action name, and parameters, then returns the result.

```python
from langchain_agenttrust import AgentTrustClient, AgentTrustConfig, AgentTrustActionTool

client = AgentTrustClient(AgentTrustConfig(...))
tool = AgentTrustActionTool(client=client)
```

### Using Tools with a LangChain Agent

```python
from langchain_openai import ChatOpenAI
from langchain.agents import AgentExecutor, create_openai_tools_agent
from langchain_core.prompts import ChatPromptTemplate
from langchain_agenttrust import (
    AgentTrustClient,
    AgentTrustConfig,
    AgentTrustDiscoverTool,
    AgentTrustActionTool,
)

config = AgentTrustConfig(
    station_url="https://station.example.com",
    api_key="ats_xxxxx",
    agent_id="my-agent-001",
)
client = AgentTrustClient(config)

tools = [
    AgentTrustDiscoverTool(client=client),
    AgentTrustActionTool(client=client),
]

llm = ChatOpenAI(model="gpt-4")
prompt = ChatPromptTemplate.from_messages([
    ("system", "You are a helpful agent with access to AgentTrust gateways."),
    ("human", "{input}"),
    ("placeholder", "{agent_scratchpad}"),
])

agent = create_openai_tools_agent(llm, tools, prompt)
executor = AgentExecutor(agent=agent, tools=tools, verbose=True)
```

## Configuration

| Parameter       | Description                                          | Environment Variable        |
|----------------|------------------------------------------------------|-----------------------------|
| `station_url`  | URL of the AgentTrust Station                        | `AGENTTRUST_STATION_URL`    |
| `api_key`      | Developer API key for authenticating with the station | `AGENTTRUST_API_KEY`        |
| `agent_id`     | Agent's external ID registered with the station       | `AGENTTRUST_AGENT_ID`       |

## API Reference

### AgentTrustClient

| Method               | Description                                          |
|---------------------|------------------------------------------------------|
| `get_certificate()` | Request (or return cached) clearance certificate      |
| `discover_gateway()`| Discover actions available on a gateway               |
| `execute_action()`  | Execute a trusted action with automatic cert management|
| `get_score()`       | Get the agent's current reputation score              |
| `close()`           | Close the underlying HTTP client                      |

### Helper Functions

| Function              | Description                                      |
|----------------------|--------------------------------------------------|
| `discover_and_list()`| Discover a gateway and return a formatted string |

## Development

```bash
# Clone the repo
git clone https://github.com/anthropics/agenttrust.git
cd agenttrust/packages/langchain

# Install in editable mode
pip install -e ".[dev]"
```

## License

MIT -- see the root [LICENSE](../../LICENSE) file for details.
