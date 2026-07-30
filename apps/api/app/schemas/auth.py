"""
Pydantic-схемы для аутентификации.
"""
from pydantic import BaseModel, EmailStr, Field


class UserRegister(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    name: str = Field(min_length=1, max_length=255)
    company: str = Field(min_length=1, max_length=255)


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str


class UserOut(BaseModel):
    id: str
    email: str
    name: str
    is_active: bool

    class Config:
        from_attributes = True


class UserMe(BaseModel):
    """Текущий пользователь + tenant + роль."""
    id: str
    email: str
    name: str
    tenant_id: str
    tenant_name: str
    role: str

    class Config:
        from_attributes = True
