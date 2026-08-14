import json
from cryptography.fernet import Fernet
from config.settings import settings

class CryptoService:
    def __init__(self):
        # Initialize Fernet with the encryption key from settings
        self.fernet = Fernet(settings.EMBEDDING_ENCRYPTION_KEY.encode())

    def encrypt_embedding(self, embedding: list[float]) -> str:
        """
        Encrypts a list of floats (embedding) into a secure string.
        """
        try:
            serialized = json.dumps(embedding).encode('utf-8')
            encrypted = self.fernet.encrypt(serialized)
            return encrypted.decode('utf-8')
        except Exception as e:
            raise RuntimeError(f"Failed to encrypt face embedding: {str(e)}")

    def decrypt_embedding(self, encrypted_embedding: str) -> list[float]:
        """
        Decrypts an encrypted string back into a list of floats.
        """
        try:
            decrypted = self.fernet.decrypt(encrypted_embedding.encode('utf-8'))
            return json.loads(decrypted.decode('utf-8'))
        except Exception as e:
            raise RuntimeError(f"Failed to decrypt face embedding: {str(e)}")

crypto_service = CryptoService()
