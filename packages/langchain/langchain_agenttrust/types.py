"""Pydantic models for the AgentTrust LangChain integration."""

from __future__ import annotations

from typing import Any, Dict, Optional

from pydantic import BaseModel, Field


class AgentTrustConfig(BaseModel):
    """Configuration required to connect to an AgentTrust Station."""

    station_url: str = Field(
        ...,
        description="URL of the AgentTrust Station (e.g. 'https://station.example.com')",
    )
    api_key: str = Field(
        ...,
        description="Developer API key for authenticating with the station",
    )
    agent_id: str = Field(
        ...,
        description="Agent's external ID as registered with the station",
    )


class GatewayAction(BaseModel):
    """Schema for a single action exposed by an AgentTrust Gateway."""

    description: str = Field(
        ...,
        description="Human-readable description of what the action does",
    )
    min_score: int = Field(
        ...,
        description="Minimum reputation score required to invoke this action",
    )
    parameters: Dict[str, Any] = Field(
        default_factory=dict,
        description="Parameter schema accepted by the action",
    )


class ActionResponse(BaseModel):
    """Response returned after executing a gateway action."""

    success: bool = Field(
        ...,
        description="Whether the action completed successfully",
    )
    data: Optional[Any] = Field(
        default=None,
        description="Payload returned by the action on success",
    )
    error: Optional[str] = Field(
        default=None,
        description="Error message if the action failed",
    )


class CertificateResponse(BaseModel):
    """Response from the station when a clearance certificate is issued."""

    token: str = Field(
        ...,
        description="JWT clearance certificate token",
    )
    expires_at: str = Field(
        ...,
        description="ISO-8601 timestamp when the certificate expires",
    )
    score: int = Field(
        ...,
        description="Agent's current reputation score embedded in the certificate",
    )


class GatewayDiscovery(BaseModel):
    """Discovery payload returned by a gateway's .well-known endpoint."""

    gateway_id: str = Field(
        ...,
        description="Unique identifier for this gateway",
    )
    actions: Dict[str, GatewayAction] = Field(
        default_factory=dict,
        description="Map of action names to their schemas",
    )
