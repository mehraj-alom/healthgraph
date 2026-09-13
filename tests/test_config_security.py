"""
Phase 0 / Increment 5 — production configuration gates (pure, CI-safe).

APP_ENV=production must refuse to start when the well-known dev secret is
in use or when Firebase service-account credentials are missing. local and
preview environments must NEVER be blocked by these production gates, and
secrets/credential contents must never appear in the raised messages.
"""

import pytest

from core.config import Settings


def _clear_firebase_json(monkeypatch):
    monkeypatch.delenv("FIREBASE_CREDENTIALS_JSON", raising=False)


class TestProductionGates:
    def test_production_refuses_dev_secret_key(self, monkeypatch, tmp_path):
        monkeypatch.setenv("APP_ENV", "production")
        _clear_firebase_json(monkeypatch)
        monkeypatch.setenv("FIREBASE_CREDENTIALS_PATH", str(tmp_path / "creds.json"))
        with pytest.raises(RuntimeError) as exc:
            Settings(secret_key="dev-secret-key")
        assert "dev-secret-key" not in str(exc.value)

    def test_production_without_firebase_creds_refused(self, monkeypatch, tmp_path):
        monkeypatch.setenv("APP_ENV", "production")
        _clear_firebase_json(monkeypatch)
        monkeypatch.setenv("FIREBASE_CREDENTIALS_PATH", str(tmp_path / "missing.json"))
        with pytest.raises(RuntimeError):
            Settings(secret_key="a-real-secret-not-the-default")

    def test_production_accepts_real_secret_and_creds(self, monkeypatch, tmp_path):
        creds = tmp_path / "creds.json"
        creds.write_text("{}")
        monkeypatch.setenv("APP_ENV", "production")
        _clear_firebase_json(monkeypatch)
        monkeypatch.setenv("FIREBASE_CREDENTIALS_PATH", str(creds))
        s = Settings(secret_key="a-real-secret-not-the-default")
        assert s.APP_ENV == "production"

    def test_production_accepts_inline_json_creds(self, monkeypatch):
        monkeypatch.setenv("APP_ENV", "production")
        monkeypatch.setenv("FIREBASE_CREDENTIALS_JSON", '{"type": "service_account"}')
        monkeypatch.delenv("FIREBASE_CREDENTIALS_PATH", raising=False)
        s = Settings(secret_key="a-real-secret-not-the-default")
        assert s.APP_ENV == "production"

    def test_dev_secret_allowed_in_local_and_preview(self, monkeypatch):
        monkeypatch.setenv("FIREBASE_CREDENTIALS_PATH", "/nonexistent/creds.json")
        _clear_firebase_json(monkeypatch)
        monkeypatch.setenv("APP_ENV", "local")
        assert Settings(secret_key="dev-secret-key").APP_ENV == "local"
        monkeypatch.setenv("APP_ENV", "preview")
        assert Settings(secret_key="dev-secret-key").APP_ENV == "preview"

    def test_default_environment_is_local(self, monkeypatch):
        _clear_firebase_json(monkeypatch)
        monkeypatch.delenv("APP_ENV", raising=False)
        monkeypatch.delenv("FIREBASE_CREDENTIALS_PATH", raising=False)
        assert Settings(secret_key="dev-secret-key").APP_ENV == "local"