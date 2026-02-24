import logging
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.middleware.sessions import SessionMiddleware

from .auth.google import (
    GoogleOAuthConfig,
    build_authorize_url,
    exchange_code_for_tokens,
    generate_nonce,
    generate_state,
    verify_id_token,
)
from .config import get_settings
from .db import create_db_and_tables, get_session
from .models import UserRecord
from .routes import router as api_router

BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"
TEMPLATES_DIR = FRONTEND_DIR / "templates"
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))
APP_VERSION = "0.26"
templates.env.globals["app_version"] = APP_VERSION
logger = logging.getLogger("coffeelog.auth")
logger.setLevel(logging.INFO)
settings = get_settings()


def get_google_config() -> GoogleOAuthConfig:
    return GoogleOAuthConfig(
        client_id=settings.google_client_id,
        client_secret=settings.google_client_secret,
        redirect_uri=settings.google_redirect_uri,
        base_url=settings.base_url,
    )

def _client_id_debug(client_id: str) -> tuple[int, str, str]:
    normalized = (client_id or "").strip()
    first = normalized[:16]
    last = normalized[-12:] if len(normalized) > 12 else normalized
    return len(normalized), first, last


def is_authenticated(request: Request) -> bool:
    return bool(request.session.get("user_id") and request.session.get("google_sub"))


app = FastAPI(title="CoffeeLog")
app.add_middleware(
    SessionMiddleware,
    secret_key=settings.session_secret,
    same_site="lax",
    https_only=settings.cookie_secure,
    session_cookie="coffeelog_session",
)
app.include_router(api_router)
app.mount("/static", StaticFiles(directory=FRONTEND_DIR / "static"), name="static")


@app.on_event("startup")
def on_startup() -> None:
    create_db_and_tables()


@app.get("/login", include_in_schema=False)
def login_page(request: Request):
    if is_authenticated(request):
        return RedirectResponse("/", status_code=302)

    return templates.TemplateResponse(
        "pages/login.html",
        {
            "request": request,
            "page_title": "Login - CoffeeLog",
            "header_title": "CoffeeLog",
            "header_subtitle": "Sign in",
            "header_show_status": False,
        },
    )


@app.get("/auth/google/start", include_in_schema=False)
def auth_google_start(request: Request):
    config = get_google_config()
    if not config.client_id:
        raise HTTPException(
            status_code=500,
            detail="GOOGLE_CLIENT_ID is empty. Check .env location and load_dotenv call.",
        )

    client_id_len, client_id_first, client_id_last = _client_id_debug(config.client_id)
    logger.info(
        "Google OAuth start config: client_id_len=%s client_id_first16=%s client_id_last12=%s redirect_uri=%s base_url=%s",
        client_id_len,
        client_id_first,
        client_id_last,
        config.redirect_uri,
        config.base_url,
    )

    state = generate_state()
    nonce = generate_nonce()

    request.session["oauth_state"] = state
    request.session["oauth_nonce"] = nonce

    authorize_url = build_authorize_url(config=config, state=state, nonce=nonce)
    logger.info("Google OAuth authorize URL: %s", authorize_url)
    return RedirectResponse(authorize_url, status_code=302)


@app.get("/auth/google/callback", include_in_schema=False)
async def auth_google_callback(request: Request, session: Session = Depends(get_session)):
    expected_state = request.session.pop("oauth_state", None)
    expected_nonce = request.session.pop("oauth_nonce", None)

    state = request.query_params.get("state")
    code = request.query_params.get("code")
    if not state or not code:
        raise HTTPException(status_code=400, detail="Invalid OAuth callback payload: missing state/code")

    if not expected_state or not expected_nonce:
        raise HTTPException(
            status_code=400,
            detail=(
                "OAuth session is missing. Start login from /login and keep host consistent "
                "(do not mix 127.0.0.1 and localhost)."
            ),
        )

    if state != expected_state:
        raise HTTPException(status_code=400, detail="Invalid OAuth state")

    config = get_google_config()
    try:
        token_payload = await exchange_code_for_tokens(config=config, code=code)
        id_token = token_payload.get("id_token")
        if not id_token:
            raise ValueError("Missing id_token")
        claims = verify_id_token(
            id_token=id_token,
            expected_nonce=expected_nonce,
            expected_audience=config.client_id,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"OAuth token validation failed: {exc}") from exc

    google_sub = str(claims.get("sub") or "").strip()
    email = str(claims.get("email") or "").strip()
    name = str(claims.get("name") or "").strip() or None
    picture = str(claims.get("picture") or "").strip() or None

    if not google_sub or not email:
        raise HTTPException(status_code=400, detail="Google claims are incomplete")

    user = session.execute(select(UserRecord).where(UserRecord.google_sub == google_sub)).scalar_one_or_none()
    if user:
        user.email = email
        user.name = name
        user.avatar_url = picture
    else:
        user = UserRecord(
            google_sub=google_sub,
            email=email,
            name=name,
            avatar_url=picture,
        )
        session.add(user)

    session.commit()
    session.refresh(user)

    request.session["user_id"] = user.id
    request.session["google_sub"] = user.google_sub
    return RedirectResponse("/settings", status_code=302)


@app.api_route("/logout", methods=["GET", "POST"], include_in_schema=False)
def logout(request: Request):
    request.session.clear()
    return RedirectResponse("/login", status_code=302)


@app.get("/app", include_in_schema=False)
def protected_app():
    return RedirectResponse("/settings", status_code=302)


@app.get("/", include_in_schema=False)
def index(request: Request):
    if not is_authenticated(request):
        return RedirectResponse("/login", status_code=302)
    return templates.TemplateResponse(
        "pages/index.html",
        {
            "request": request,
            "page_title": "CoffeeLog",
            "header_title": "CoffeeLog",
            "header_subtitle": "Private coffee journal",
            "header_show_status": True,
        },
    )


@app.get("/create", include_in_schema=False)
def create_page(request: Request):
    if not is_authenticated(request):
        return RedirectResponse("/login", status_code=302)
    return templates.TemplateResponse(
        "pages/create.html",
        {
            "request": request,
            "page_title": "New log - CoffeeLog",
            "header_title": "Coffee",
            "header_subtitle": "Capture brew and tasting details",
            "header_show_status": False,
        },
    )


@app.get("/view", include_in_schema=False)
def view_page(request: Request):
    if not is_authenticated(request):
        return RedirectResponse("/login", status_code=302)
    return templates.TemplateResponse(
        "pages/view.html",
        {
            "request": request,
            "page_title": "View Entry - CoffeeLog",
            "header_title": "Entry Details",
            "header_subtitle": "Read-only coffee log entry",
            "header_show_status": False,
        },
    )


@app.get("/settings", include_in_schema=False)
def settings_page(request: Request, session: Session = Depends(get_session)):
    if not is_authenticated(request):
        return RedirectResponse("/login", status_code=302)

    user_id = request.session.get("user_id")
    user = session.get(UserRecord, int(user_id)) if user_id else None
    if not user:
        request.session.clear()
        return RedirectResponse("/login", status_code=302)

    return templates.TemplateResponse(
        "pages/settings.html",
        {
            "request": request,
            "page_title": "Settings - CoffeeLog",
            "header_title": "Settings",
            "header_subtitle": "Offline and sync controls",
            "header_show_status": False,
            "user": user,
        },
    )


@app.get("/sw.js", include_in_schema=False)
def service_worker():
    return FileResponse(
        FRONTEND_DIR / "pwa" / "sw.js",
        media_type="application/javascript",
        headers={
            "Service-Worker-Allowed": "/",
            "Cache-Control": "no-cache, no-store, must-revalidate",
        },
    )


@app.get("/manifest.json", include_in_schema=False)
def manifest():
    return FileResponse(
        FRONTEND_DIR / "pwa" / "manifest.json",
        media_type="application/manifest+json",
        headers={"Cache-Control": "no-cache"},
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("backend.main:app", host="127.0.0.1", port=8000, reload=True)
