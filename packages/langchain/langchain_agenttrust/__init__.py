"""langchain-agenttrust -- LangChain integration for the AgentTrust protocol.

Provides an async client, LangChain tools, and Pydantic types for
discovering gateways, requesting clearance certificates, and executing
trusted actions.

Quick start::

    from langchain_agenttrust import AgentTrustClient, AgentTrustConfig

    client = AgentTrustClient(AgentTrustConfig(
        station_url="https://station.example.com",
        api_key="ats_xxxxx",
        agent_id="my-agent-001",
    ))
"""

from .client import AgentTrustClient
from .gateway import discover_and_list
from .tools import AgentTrustActionTool, AgentTrustDiscoverTool
from .types import (
    ActionResponse,
    AgentTrustConfig,
    CertificateResponse,
    GatewayAction,
    GatewayDiscovery,
)

__all__ = [
    # Client
    "AgentTrustClient",
    # Tools
    "AgentTrustDiscoverTool",
    "AgentTrustActionTool",
    # Configuration & types
    "AgentTrustConfig",
    "GatewayAction",
    "ActionResponse",
    "CertificateResponse",
    "GatewayDiscovery",
    # Helpers
    "discover_and_list",
]
