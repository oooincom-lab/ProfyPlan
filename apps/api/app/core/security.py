"""
JWT-аутентификация: создание, проверка токенов, хеширование паролей.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
from jose import JWTError, jwt

from app.core.config import settings

ALGORITHM = settings.jwt_algorithm
SECRET_KEY = settin…_key


def hash_password(password: str) -> str:
    """bcrypt-хеш пароля."""
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Проверка пароля против хеша."""
    return bcrypt.checkpw(plain_password.encode(), hashed_password.encode())


def create_access_token(
    user_id: str,
    tenant_id: Optional[str] = None,
    expires_delta: Optional[timedelta] = None,
) -> str:
    """Создать JWT access-токен."""
    to_encode = {"sub": user_id}
    if tenant_id:
        to_encode["tenant_id"] = tenant_id
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=settings.jwt_expire_minutes))
    to_encode["exp"] = expire
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def create_refresh_token(user_id: str) -> str:
    """Создать refresh-токен (30 дней)."""
    expire = datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_days)
    to_encode = {"sub": user_id, "type": "refresh", "exp": expire}
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> Optional[dict]:
    """Декодировать и проверить JWT-токен."""
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        return None
