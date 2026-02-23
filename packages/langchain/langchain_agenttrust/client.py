"""AgentTrust client — Python equivalent of the JS Agent SDK.

Handles certificate management, gateway discovery, and action execution
using httpx for async HTTP requests.
"""

from __future__ import annotations

import base64
import json
import time
from typing import Any, Dict, List, Optional
from urllib.parse import quote

import httpx

from .types import (
    ActionResponse,
    AgentTrustConfig,
    CertificateResponse,
    GatewayAction,
    GatewayDiscovery,
)


class AgentTrustClient:
    """Main client for interacting with the AgentTrust protocol.

    Mirrors the behaviour of the TypeScript ``AgentClient`` in
    ``@agent-trust/sdk``, adapted for Python with ``httpx``.

    Usage::

        from langchain_agenttrust import AgentTrustClient, AgentTrustConfig

        client = AgentTrustClient(AgentTrustConfig(
            station_url="https://station.example.com",
            api_key="ats_xxxxx",
            agent_id="my-agent-001",
        ))

        discovery = await client.discover_gateway("https://shop.example.com/agent-gateway")
        result = await client.execute_action(
            "https://shop.example.com/agent-gateway",
            "search_products",
            {"query": "blue widgets"},
        )
        await client.close()
    """

    def __init__(self, config: AgentTrustConfig) -> None:
        self._station_url: str = config.station_url.rstrip("/")
        self._api_key: str = config.api_key
        self._agent_id: str = config.agent_id

        # Certificate caching
        self._cached_token: Optional[str] = None
        self._token_expiry: float = 0.0

        self._http: httpx.AsyncClient = httpx.AsyncClient(timeout=30.0)

    # ------------------------------------------------------------------
    # Certificate management
    # ------------------------------------------------------------------

    async def get_certificate(
        self,
        force_refresh: bool = False,
        scope: Optional[List[str]] = None,
    ) -> str:
        """Request a clearance certificate from the station.

        The certificate is cached and reused until 30 seconds before its
        expiry.  Pass ``force_refresh=True`` to always fetch a new one.

        Parameters
        ----------
        force_refresh:
            Bypass the cache and request a fresh certificate.
        scope:
            Optional list of action scopes this certificate should be
            restricted to.  If ``None``, the certificate has wildcard
            access.

        Returns
        -------
        str
            The JWT certificate token.
        """
        # Return cached certificate if still valid (with 30 s buffer)
        if (
            not force_refresh
            and self._cached_token is not None
            and time.time() < self._token_expiry - 30
        ):
            return self._cached_token

        body: Dict[str, Any] = {"agentId": self._agent_id}
        if scope:
            body["scope"] = scope

        response = await self._http.post(
            f"{self._station_url}/certificates/request",
            headers={
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json",
            },
            json=body,
        )

        if response.status_code >= 400:
            try:
                error_body = response.json()
                msg = error_body.get("error", response.reason_phrase)
            except Exception:
                msg = response.reason_phrase
            raise RuntimeError(f"Certificate request failed: {msg}")

        data = response.json().get("data", response.json())
        cert = CertificateResponse(
            token=data["token"],
            expires_at=data["expiresAt"],
            score=data["score"],
        )

        self._cached_token = cert.token
        # Parse ISO-8601 expiry to epoch seconds
        from datetime import datetime, timezone

        expiry_dt = datetime.fromisoformat(cert.expires_at.replace("Z", "+00:00"))
        self._token_expiry = expiry_dt.timestamp()

        return cert.token

    # ------------------------------------------------------------------
    # Gateway discovery
    # ------------------------------------------------------------------

    async def discover_gateway(self, gateway_url: str) -> GatewayDiscovery:
        """Discover what actions an AgentTrust gateway supports.

        Parameters
        ----------
        gateway_url:
            Base URL of the gateway (e.g.
            ``"https://shop.example.com/agent-gateway"``).

        Returns
        -------
        GatewayDiscovery
            Parsed discovery payload with gateway ID and available actions.
        """
        url = gateway_url.rstrip("/")
        response = await self._http.get(f"{url}/.well-known/agent-gateway")

        if response.status_code >= 400:
            raise RuntimeError(f"Gateway discovery failed: {response.reason_phrase}")

        payload = response.json()

        # Normalise the action entries from camelCase (JS convention) to
        # our Pydantic models.
        actions: Dict[str, GatewayAction] = {}
        raw_actions = payload.get("actions", {})
        for name, info in raw_actions.items():
            actions[name] = GatewayAction(
                description=info.get("description", ""),
                min_score=info.get("minScore", 0),
                parameters=info.get("parameters", {}),
            )

        return GatewayDiscovery(
            gateway_id=payload.get("gatewayId", ""),
            actions=actions,
        )

    # ------------------------------------------------------------------
    # Action execution
    # ------------------------------------------------------------------

    async def execute_action(
        self,
        gateway_url: str,
        action_name: str,
        params: Optional[Dict[str, Any]] = None,
    ) -> ActionResponse:
        """Execute a trusted action on a gateway.

        Automatically manages the certificate — requests one if needed
        and retries once with a fresh certificate on a 401.

        Parameters
        ----------
        gateway_url:
            Base URL of the gateway.
        action_name:
            The action to invoke (must be listed in gateway discovery).
        params:
            Parameters to pass to the action.

        Returns
        -------
        ActionResponse
            The gateway's response with ``success``, ``data``, and
            optional ``error``.
        """
        url = gateway_url.rstrip("/")
        cert = await self.get_certificate()

        response = await self._http.post(
            f"{url}/actions/{quote(action_name, safe='')}",
            headers={
                "Authorization": f"Bearer {cert}",
                "Content-Type": "application/json",
            },
            json={"parameters": params or {}},
        )

        # On 401 (expired / invalid cert), retry once with a fresh cert
        if response.status_code == 401:
            fresh_cert = await self.get_certificate(force_refresh=True)
            response = await self._http.post(
                f"{url}/actions/{quote(action_name, safe='')}",
                headers={
                    "Authorization": f"Bearer {fresh_cert}",
                    "Content-Type": "application/json",
                },
                json={"parameters": params or {}},
            )

        result = response.json()
        return ActionResponse(
            success=result.get("success", False),
            data=result.get("data"),
            error=result.get("error"),
        )

    # ------------------------------------------------------------------
    # Score
    # ------------------------------------------------------------------

    async def get_score(self) -> int:
        """Return the agent's current reputation score.

        Decodes the score from the JWT certificate payload (the middle
        Base64-encoded segment).

        Returns
        -------
        int
            The reputation score.
        """
        token = await self.get_certificate()

        # JWT structure: header.payload.signature
        parts = token.split(".")
        if len(parts) < 2:
            raise ValueError("Certificate token is not a valid JWT")

        # Base64url decode the payload
        payload_b64 = parts[1]
        # Add padding if necessary
        padding = 4 - len(payload_b64) % 4
        if padding != 4:
            payload_b64 += "=" * padding

        payload_bytes = base64.urlsafe_b64decode(payload_b64)
        payload = json.loads(payload_bytes)

        return int(payload.get("score", 0))

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def close(self) -> None:
        """Close the underlying HTTP client and release resources."""
        await self._http.aclose()

    async def __aenter__(self) -> "AgentTrustClient":
        return self

    async def __aexit__(self, *exc: Any) -> None:
        await self.close()
