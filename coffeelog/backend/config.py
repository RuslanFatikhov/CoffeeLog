import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from dotenv import find_dotenv, load_dotenv


BASE_DIR = Path(__file__).resolve().parent.parent
ENV_PATH = BASE_DIR / ".env"
FALLBACK_ENV_PATH = BASE_DIR / ".venv" / ".env"


def load_environment() -> None:
    if ENV_PATH.exists():
        load_dotenv(dotenv_path=ENV_PATH, override=False)

        loaded_client_id = os.getenv("GOOGLE_CLIENT_ID", "").strip()
        if loaded_client_id and "your-google-client-id" not in loaded_client_id:
            return

    if FALLBACK_ENV_PATH.exists():
        load_dotenv(dotenv_path=FALLBACK_ENV_PATH, override=True)
        return

    discovered = find_dotenv(usecwd=True)
    if discovered:
        load_dotenv(dotenv_path=discovered, override=False)


@dataclass(frozen=True)
class Settings:
    google_client_id: str
    google_client_secret: str
    google_redirect_uri: str
    session_secret: str
    base_url: str

    @property
    def cookie_secure(self) -> bool:
        return self.base_url.lower().startswith("https://")


def _required_env(name: str) -> str:
    raw = os.getenv(name, "").strip()
    if len(raw) >= 2 and raw[0] == raw[-1] and raw[0] in {"'", '"'}:
        raw = raw[1:-1].strip()
    return raw


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    load_environment()

    google_client_id = _required_env("GOOGLE_CLIENT_ID")
    google_client_secret = _required_env("GOOGLE_CLIENT_SECRET")
    google_redirect_uri = _required_env("GOOGLE_REDIRECT_URI")
    session_secret = _required_env("SESSION_SECRET")
    base_url = _required_env("BASE_URL") or "http://localhost:8000"

    if not google_client_id or not google_client_secret:
        raise RuntimeError(
            "Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET. Check .env location and load_dotenv call."
        )

    if ".apps.googleusercontent.com" not in google_client_id:
        raise RuntimeError(
            "Invalid GOOGLE_CLIENT_ID format. Expected *.apps.googleusercontent.com. "
            "Check .env location and load_dotenv call."
        )

    if "your-google-client-id" in google_client_id:
        raise RuntimeError(
            "GOOGLE_CLIENT_ID looks like a placeholder. Put real credentials in .env "
            "(project root or .venv/.env)."
        )

    if "your-google-client-secret" in google_client_secret:
        raise RuntimeError(
            "GOOGLE_CLIENT_SECRET looks like a placeholder. Put real credentials in .env "
            "(project root or .venv/.env)."
        )

    if not google_redirect_uri:
        raise RuntimeError("Missing GOOGLE_REDIRECT_URI. Check .env location and load_dotenv call.")

    if not session_secret:
        raise RuntimeError("Missing SESSION_SECRET. Check .env location and load_dotenv call.")

    return Settings(
        google_client_id=google_client_id,
        google_client_secret=google_client_secret,
        google_redirect_uri=google_redirect_uri,
        session_secret=session_secret,
        base_url=base_url,
    )
