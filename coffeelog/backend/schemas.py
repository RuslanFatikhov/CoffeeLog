from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class EntryBase(BaseModel):
    id: str
    created_at: str
    brew_date: str
    coffee_name: str

    roastery: Optional[str] = None
    origin: Optional[str] = None
    process: Optional[str] = None
    brew_method: Optional[str] = None
    grind_size: Optional[str] = None
    water_temp: Optional[float] = None
    dose: Optional[float] = None
    yield_amount: Optional[float] = Field(default=None, alias="yield")
    brew_time: Optional[str] = None

    aroma: list[str] = Field(default_factory=list)
    flavor: list[str] = Field(default_factory=list)
    aftertaste: list[str] = Field(default_factory=list)
    defects: list[str] = Field(default_factory=list)

    acidity: Optional[int] = None
    sweetness: Optional[int] = None
    bitterness: Optional[int] = None
    body: Optional[int] = None
    balance: Optional[int] = None
    overall: Optional[int] = None

    notes: Optional[str] = None


class EntryIn(EntryBase):
    model_config = ConfigDict(populate_by_name=True)


class EntryOut(EntryBase):
    model_config = ConfigDict(populate_by_name=True, from_attributes=True)
