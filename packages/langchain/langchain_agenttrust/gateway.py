"""Gateway discovery helper utilities."""

from __future__ import annotations

from .client import AgentTrustClient


async def discover_and_list(client: AgentTrustClient, gateway_url: str) -> str:
    """Discover a gateway and return a nicely formatted action list.

    This is a convenience function that combines discovery with
    human-readable formatting.  Useful for quick inspection or for
    feeding the output into an LLM prompt.

    Parameters
    ----------
    client:
        An initialised :class:`AgentTrustClient`.
    gateway_url:
        Base URL of the gateway to discover.

    Returns
    -------
    str
        A multi-line string listing every action, its description,
        minimum required score, and parameter info.
    """
    discovery = await client.discover_gateway(gateway_url)

    lines = [
        f"Gateway: {discovery.gateway_id}",
        f"Actions ({len(discovery.actions)}):",
        "",
    ]

    for name, action in discovery.actions.items():
        lines.append(f"  [{name}]")
        lines.append(f"    {action.description}")
        lines.append(f"    Minimum score: {action.min_score}")

        if action.parameters:
            param_parts = []
            for param_name, param_info in action.parameters.items():
                if isinstance(param_info, dict):
                    ptype = param_info.get("type", "any")
                    required = param_info.get("required", False)
                    marker = " (required)" if required else ""
                    desc = param_info.get("description", "")
                    entry = f"{param_name}: {ptype}{marker}"
                    if desc:
                        entry += f" -- {desc}"
                    param_parts.append(entry)
                else:
                    param_parts.append(str(param_name))
            lines.append("    Parameters:")
            for part in param_parts:
                lines.append(f"      - {part}")
        lines.append("")

    return "\n".join(lines)
