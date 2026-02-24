import secrets
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode

import httpx
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token

GOOGLE_AUTHORIZE_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"


@dataclass(frozen=True)
class GoogleOAuthConfig:
    client_id: str
    client_secret: str
    redirect_uri: str
    base_url: str


def generate_state() -> str:
    return secrets.token_urlsafe(32)


def generate_nonce() -> str:
    return secrets.token_urlsafe(32)


def build_authorize_url(config: GoogleOAuthConfig, state: str, nonce: str) -> str:
    query = urlencode(
        {
            "client_id": config.client_id,
            "redirect_uri": config.redirect_uri,
            "response_type": "code",
            "scope": "openid email profile",
            "state": state,
            "nonce": nonce,
            "prompt": "select_account",
            "max_age": "0",
            "access_type": "offline",
        }
    )
    return f"{GOOGLE_AUTHORIZE_ENDPOINT}?{query}"


async def exchange_code_for_tokens(config: GoogleOAuthConfig, code: str) -> dict[str, Any]:
    payload = {
        "client_id": config.client_id,
        "client_secret": config.client_secret,
        "code": code,
        "redirect_uri": config.redirect_uri,
        "grant_type": "authorization_code",
    }
    headers = {"Content-Type": "application/x-www-form-urlencoded"}
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.post(GOOGLE_TOKEN_ENDPOINT, data=payload, headers=headers)
    response.raise_for_status()
    return response.json()


def verify_id_token(id_token: str, expected_nonce: str, expected_audience: str) -> dict[str, Any]:
    request = google_requests.Request()
    claims = google_id_token.verify_oauth2_token(id_token, request, audience=expected_audience)
    token_nonce = claims.get("nonce")
    if not token_nonce or token_nonce != expected_nonce:
        raise ValueError("Invalid nonce")
    return claims
