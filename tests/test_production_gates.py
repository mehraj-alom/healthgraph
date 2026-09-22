"""Production-gate tripwires (Phase 6).

Source-contract tests in the P15 style: they fail if the guarantees below
regress. All read the real repository tree — no live services needed.

  - no response-body/health-content logging in request paths
  - no unpinned bare dependencies in requirements.txt
  - Dockerfile runs as non-root and cannot bake tooling secrets
  - .dockerignore keeps secrets and heavy toolchains out of the image
"""

import pathlib
import re

PROJECT_ROOT = pathlib.Path(__file__).resolve().parent.parent


def _python_sources(*folders: str):
    for folder in folders:
        for path in (PROJECT_ROOT / folder).rglob("*.py"):
            if "__pycache__" in path.parts:
                continue
            yield path


class TestNoResponseContentLogging:
    """Health/response content must never reach logs (metadata only)."""

    # Known-safe lines: identifiers and status codes, never content.
    ALLOWLIST = {
        "app/api/v1/daily_logs.py:1391",
        "services/vectorization/embeddings.py:41",
    }

    def test_no_response_or_body_interpolation_in_logs(self):
        pattern = re.compile(
            r"log(?:ger)?\.(?:debug|info|warning|error|exception|critical)\s*\("
            r"[^)]*\b(response\.content|response\.text|response\.body|"
            r"request\.body|raw_bytes|file_bytes)\b",
        )
        hits = []
        for path in _python_sources("app", "services", "core", "workers"):
            for lineno, line in enumerate(path.read_text().splitlines(), 1):
                if pattern.search(line):
                    key = f"{path.relative_to(PROJECT_ROOT)}:{lineno}"
                    if key not in self.ALLOWLIST:
                        hits.append(key)
        assert hits == [], f"response/body content reaches logs: {hits}"


class TestDependencyPinning:
    def test_no_bare_unpinned_requirements(self):
        lines = (PROJECT_ROOT / "requirements.txt").read_text().splitlines()
        bare = [
            line.strip()
            for line in lines
            if line.strip()
            and not line.strip().startswith("#")
            and not any(op in line for op in (">=", "==", "~=", "<=", ">", "<"))
        ]
        assert bare == [], f"unpinned dependencies (non-reproducible): {bare}"

    def test_unused_openrouter_dependency_stays_removed(self):
        # Phase 6 removed it: zero imports, only env-var usage via
        # langchain-openai. Re-adding requires a version floor + an import.
        text = (PROJECT_ROOT / "requirements.txt").read_text()
        assert "openrouter" not in text.lower()


class TestDockerProductionHygiene:
    def test_api_does_not_run_as_root(self):
        dockerfile = (PROJECT_ROOT / "Dockerfile").read_text()
        assert re.search(r"^USER\s+\S+", dockerfile, re.M) is not None

    def test_tooling_secrets_excluded_from_build_context(self):
        ignore = (PROJECT_ROOT / ".dockerignore").read_text()
        for entry in ("opencode.json", "skills-lock.json", ".agents/", ".claude/", ".opencode/"):
            assert entry in ignore, f"{entry} must stay out of the image"

    def test_heavy_toolchains_excluded_from_build_context(self):
        ignore = (PROJECT_ROOT / ".dockerignore").read_text()
        assert "frontend/node_modules/" in ignore
