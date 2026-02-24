from datetime import datetime
from typing import Optional

from sqlalchemy import Float, Integer, JSON, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class EntryRecord(Base):
    __tablename__ = "entries"

    id: Mapped[str] = mapped_column(String, primary_key=True, index=True)
    user_key: Mapped[str] = mapped_column(String, index=True)

    created_at: Mapped[str] = mapped_column(String, nullable=False)
    brew_date: Mapped[str] = mapped_column(String, nullable=False)
    coffee_name: Mapped[str] = mapped_column(String, nullable=False)

    roastery: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    origin: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    process: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    brew_method: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    grind_size: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    water_temp: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    dose: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    yield_amount: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    brew_time: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    aroma: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    flavor: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    aftertaste: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    defects: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)

    acidity: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    sweetness: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    bitterness: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    body: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    balance: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    overall: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


class UserRecord(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    google_sub: Mapped[str] = mapped_column(String, unique=True, index=True, nullable=False)
    email: Mapped[str] = mapped_column(String, nullable=False)
    name: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    avatar_url: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    created_at: Mapped[str] = mapped_column(String, default=lambda: datetime.utcnow().isoformat(), nullable=False)
    updated_at: Mapped[str] = mapped_column(
        String,
        default=lambda: datetime.utcnow().isoformat(),
        onupdate=lambda: datetime.utcnow().isoformat(),
        nullable=False,
    )
