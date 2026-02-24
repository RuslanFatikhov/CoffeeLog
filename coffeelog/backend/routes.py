from typing import Union

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import get_session
from .models import EntryRecord
from .schemas import EntryIn, EntryOut

router = APIRouter(prefix="/api", tags=["entries"])


def get_authenticated_google_sub(request: Request) -> str:
    google_sub = str(request.session.get("google_sub") or "").strip()
    user_id = request.session.get("user_id")
    if not google_sub or not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    return google_sub


@router.get("/entries", response_model=list[EntryOut])
def get_entries(
    request: Request,
    session: Session = Depends(get_session),
):
    google_sub = get_authenticated_google_sub(request)
    statement = select(EntryRecord).where(EntryRecord.user_key == google_sub)
    rows = session.execute(statement).scalars().all()
    return [EntryOut.model_validate(row, from_attributes=True) for row in rows]


@router.get("/entry/{entry_id}", response_model=EntryOut)
def get_entry(
    request: Request,
    entry_id: str,
    session: Session = Depends(get_session),
):
    google_sub = get_authenticated_google_sub(request)
    row = session.get(EntryRecord, entry_id)
    if not row or row.user_key != google_sub:
        raise HTTPException(status_code=404, detail="Entry not found")
    return EntryOut.model_validate(row, from_attributes=True)


@router.post("/entries", response_model=list[EntryOut])
def upsert_entries(
    request: Request,
    payload: Union[EntryIn, list[EntryIn]],
    session: Session = Depends(get_session),
):
    google_sub = get_authenticated_google_sub(request)
    entries = payload if isinstance(payload, list) else [payload]

    saved: list[EntryRecord] = []
    for entry in entries:
        data = entry.model_dump(by_alias=True)
        if "yield" in data:
            data["yield_amount"] = data.pop("yield")
        data["user_key"] = google_sub

        existing = session.get(EntryRecord, entry.id)
        if existing and existing.user_key != x_user_key:
            raise HTTPException(status_code=403, detail="Entry belongs to another user")

        if existing:
            for key, value in data.items():
                setattr(existing, key, value)
            saved.append(existing)
        else:
            new_row = EntryRecord(**data)
            session.add(new_row)
            saved.append(new_row)

    session.commit()
    for row in saved:
        session.refresh(row)

    return [EntryOut.model_validate(row, from_attributes=True) for row in saved]


@router.delete("/entry/{entry_id}")
def delete_entry(
    request: Request,
    entry_id: str,
    session: Session = Depends(get_session),
):
    google_sub = get_authenticated_google_sub(request)
    row = session.get(EntryRecord, entry_id)
    if not row or row.user_key != google_sub:
        raise HTTPException(status_code=404, detail="Entry not found")

    session.delete(row)
    session.commit()
    return JSONResponse({"ok": True})
