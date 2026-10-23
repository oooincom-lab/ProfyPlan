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

    # Облачный обмен (токены не хранятся в БД)
    yandex_disk_token: str = ""
    yandex_disk_root: str = "/ProfyPlan"
    google_drive_access_token: str = ""
    # OAuth-приложения ProfyPlan: пользователь только подтверждает доступ,
    # client_id/client_secret остаются на сервере.
    yandex_oauth_client_id: str = ""
    yandex_oauth_client_secret: str = ""
    yandex_oauth_scope: str = "cloud_api:disk.read cloud_api:disk.write cloud_api:disk.info"
    google_oauth_client_id: str = ""
    google_oauth_client_secret: str = ""
    # drive, а не drive.file: облачная папка может быть создана стороной 1С
    # и расшарена ProfyPlan; drive.file не видит чужие shared-папки.
    google_oauth_scope: str = "https://www.googleapis.com/auth/drive"
    cloud_oauth_callback_url: str = "https://profyplan.ru/api/v1/integration/cloud/oauth/callback"
    cloud_oauth_success_url: str = "https://profyplan.ru/workspace"
    cloud_oauth_failure_url: str = "https://profyplan.ru/workspace"
    # Ключ шифрования refresh token. Если пуст — используется JWT secret
    # (для локальной разработки); в production задайте отдельный ключ.
    cloud_token_encryption_key: str = ""
    # Периодический опрос облачных подключений; блокировка не даёт
    # нескольким API-воркерам опрашивать одно подключение одновременно.
    cloud_scheduler_enabled: bool = True
    cloud_scheduler_interval_seconds: int = 60

    # CORS
    cors_origins: list[str] = [
        "http://localhost:3000",
        "https://app.profyplan.ru",
    ]

    # ЮKassa
    yookassa_shop_id: str = ""
    yookassa_secret_key: str = ""

    # SMTP (Gmail)
    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 587
    smtp_user: str = "profyplan.ai@gmail.com"
    smtp_password: str = ""
    admin_email: str = "profyplan.ai@gmail.com"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
