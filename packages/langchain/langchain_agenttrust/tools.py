"""LangChain tool wrappers for AgentTrust operations.

Provides two tools that LangChain agents can use to interact with
AgentTrust gateways:

* **AgentTrustDiscoverTool** -- discover what actions a gateway offers.
* **AgentTrustActionTool** -- execute a trusted action on a gateway.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, Optional, Type

from langchain_core.callbacks import (
    AsyncCallbackManagerForToolRun,
    CallbackManagerForToolRun,
)
from langchain_core.tools import BaseTool
from pydantic import BaseModel, Field

from .client import AgentTrustClient


# ------------------------------------------------------------------
# Input schemas
# ------------------------------------------------------------------


class _DiscoverInput(BaseModel):
    gateway_url: str = Field(
        ...,
        description="The base URL of the AgentTrust gateway to discover (e.g. 'https://shop.example.com/agent-gateway').",
    )


class _ActionInput(BaseModel):
    gateway_url: str = Field(
        ...,
        description="The base URL of the AgentTrust gateway.",
    )
    action_name: str = Field(
        ...,
        description="Name of the action to execute on the gateway.",
    )
    params: dict = Field(
        default_factory=dict,
        description="Parameters to pass to the action.",
    )


# ------------------------------------------------------------------
# Tools
# ------------------------------------------------------------------


class AgentTrustDiscoverTool(BaseTool):
    """Discover available actions on an AgentTrust gateway.

    Input is the gateway URL as a plain string.
    Returns a formatted listing of every action the gateway supports,
    including descriptions and minimum required reputation scores.
    """

    name: str = "agenttrust_discover"
    description: str = (
        "Discover available actions on an AgentTrust gateway. "
        "Input is the gateway URL."
    )
    args_schema: Type[BaseModel] = _DiscoverInput

    client: AgentTrustClient = Field(exclude=True)

    class Config:
        arbitrary_types_allowed = True

    def _run(
        self,
        gateway_url: str,
        run_manager: Optional[CallbackManagerForToolRun] = None,
    ) -> str:
        """Synchronous wrapper -- delegates to the async implementation."""
        return asyncio.get_event_loop().run_until_complete(
            self._arun(gateway_url, run_manager=None)
        )

    async def _arun(
        self,
        gateway_url: str,
        run_manager: Optional[AsyncCallbackManagerForToolRun] = None,
    ) -> str:
        """Discover a gateway and return a human-readable action list."""
        try:
            discovery = await self.client.discover_gateway(gateway_url)
        except Exception as exc:
            return f"Error discovering gateway: {exc}"

        if not discovery.actions:
            return f"Gateway '{discovery.gateway_id}' exposes no actions."

        lines = [f"Gateway: {discovery.gateway_id}", "Available actions:", ""]
        for action_name, action in discovery.actions.items():
            lines.append(f"  - {action_name}")
            lines.append(f"    Description: {action.description}")
            lines.append(f"    Min score:   {action.min_score}")
            if action.parameters:
                params_str = ", ".join(
                    f"{k} ({v.get('type', 'any')})"
                    if isinstance(v, dict)
                    else f"{k}"
                    for k, v in action.parameters.items()
                )
                lines.append(f"    Parameters:  {params_str}")
            lines.append("")

        return "\n".join(lines)


class AgentTrustActionTool(BaseTool):
    """Execute a trusted action on an AgentTrust gateway.

    Input is a JSON string (or structured input) with ``gateway_url``,
    ``action_name``, and optional ``params``.  Returns the result as a
    string.
    """

    name: str = "agenttrust_action"
    description: str = (
        "Execute a trusted action on an AgentTrust gateway. "
        "Input is JSON with gateway_url, action_name, and params."
    )
    args_schema: Type[BaseModel] = _ActionInput

    client: AgentTrustClient = Field(exclude=True)

    class Config:
        arbitrary_types_allowed = True

    def _run(
        self,
        gateway_url: str,
        action_name: str,
        params: Optional[dict] = None,
        run_manager: Optional[CallbackManagerForToolRun] = None,
    ) -> str:
        """Synchronous wrapper -- delegates to the async implementation."""
        return asyncio.get_event_loop().run_until_complete(
            self._arun(gateway_url, action_name, params, run_manager=None)
        )

    async def _arun(
        self,
        gateway_url: str,
        action_name: str,
        params: Optional[dict] = None,
        run_manager: Optional[AsyncCallbackManagerForToolRun] = None,
    ) -> str:
        """Execute the action and return the result as a string."""
        try:
            result = await self.client.execute_action(
                gateway_url,
                action_name,
                params or {},
            )
        except Exception as exc:
            return f"Error executing action: {exc}"

        if result.success:
            return json.dumps(
                {"success": True, "data": result.data},
                indent=2,
                default=str,
            )
        else:
            return json.dumps(
                {"success": False, "error": result.error},
                indent=2,
                default=str,
            )
