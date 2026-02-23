#!/usr/bin/env python3
"""Demo script for the langchain-agenttrust package.

Shows how to:
  1. Create an AgentTrustClient from environment variables.
  2. Discover a gateway's available actions.
  3. Execute a search action on the gateway.
  4. Print the results.

Set the following environment variables before running:

    AGENTTRUST_STATION_URL  -- e.g. https://station.example.com
    AGENTTRUST_API_KEY      -- your developer API key
    AGENTTRUST_AGENT_ID     -- the agent ID registered with the station

Usage:
    python demo.py
"""

from __future__ import annotations

import asyncio
import os
import sys

from langchain_agenttrust import (
    AgentTrustClient,
    AgentTrustConfig,
    AgentTrustDiscoverTool,
    AgentTrustActionTool,
    discover_and_list,
)


GATEWAY_URL = os.getenv(
    "AGENTTRUST_GATEWAY_URL",
    "https://shop.example.com/agent-gateway",
)


async def main() -> None:
    # ── 1. Build configuration from env vars ──────────────────────
    station_url = os.environ.get("AGENTTRUST_STATION_URL")
    api_key = os.environ.get("AGENTTRUST_API_KEY")
    agent_id = os.environ.get("AGENTTRUST_AGENT_ID")

    if not all([station_url, api_key, agent_id]):
        print(
            "Error: please set AGENTTRUST_STATION_URL, "
            "AGENTTRUST_API_KEY, and AGENTTRUST_AGENT_ID.",
            file=sys.stderr,
        )
        sys.exit(1)

    config = AgentTrustConfig(
        station_url=station_url,  # type: ignore[arg-type]
        api_key=api_key,          # type: ignore[arg-type]
        agent_id=agent_id,        # type: ignore[arg-type]
    )

    # ── 2. Create the client ──────────────────────────────────────
    async with AgentTrustClient(config) as client:

        # ── 3. Discover the gateway ──────────────────────────────
        print(f"Discovering gateway at {GATEWAY_URL} ...")
        listing = await discover_and_list(client, GATEWAY_URL)
        print(listing)

        # ── 4. Execute a search action ───────────────────────────
        print("Executing 'search_products' action ...")
        result = await client.execute_action(
            GATEWAY_URL,
            "search_products",
            {"query": "blue widgets"},
        )

        if result.success:
            print(f"Success! Data: {result.data}")
        else:
            print(f"Action failed: {result.error}")

        # ── 5. Show current reputation score ─────────────────────
        score = await client.get_score()
        print(f"Agent reputation score: {score}")

        # ── 6. Using LangChain tools directly ────────────────────
        print("\n--- LangChain tool usage ---")

        discover_tool = AgentTrustDiscoverTool(client=client)
        action_tool = AgentTrustActionTool(client=client)

        print(f"Discover tool: {discover_tool.name}")
        print(f"Action tool:   {action_tool.name}")

        # Invoke the discover tool the way LangChain agents would
        discover_result = await discover_tool.ainvoke(
            {"gateway_url": GATEWAY_URL}
        )
        print(discover_result)


if __name__ == "__main__":
    asyncio.run(main())
