from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")
    
    PORT: int = 8000
    EMBEDDING_ENCRYPTION_KEY: str = "f1RjLU5HMG1xWktNek11eDJnZXZ1T1k4clJpWjA5cWw="

settings = Settings()
