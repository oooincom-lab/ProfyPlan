"""
Настройки приложения — все секреты через .env.
"""
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "ProfyPlan"
    debug: bool = False

    # База данных
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/profyplan"

    # Redis
    redis_url: str = "redis://localhost:6379/0"

    # JWT
    jwt_secret_key: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 1440  # 24 часа
    refresh_token_days: int = 30

    # CORS
    cors_origins: list[str] = [
        "http://localhost:3000",
        "https://app.profyplan.ru",
    ]

    # ЮKassa
    yookassa_shop_id: str = ""
    yookassa_secret_key: str = ""

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
