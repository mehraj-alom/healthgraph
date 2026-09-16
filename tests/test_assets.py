"""
Phase 0 / Increment 6 — anatomy GLB asset-reference integrity tests.

Guards the Increment-6 asset cleanup and the canonical-reference contract:

  - frontend/assets/anatomy/ is the bundled (native require()) source of
    truth; every file referenced from the app must exist.
  - frontend/public/anatomy/ mirrors those files so the web downloader can
    serve byte-identical meshes by name (verified via checksums in I6);
    every non-meshopt asset must have a mirror.
  - the deleted src/assets/models/human_body.glb placeholder must never be
    referenced again.

Pure tests, no webgl/three.js or Metro execution required.
"""

import re
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
FRONTEND = REPO / "frontend"
ASSETS = FRONTEND / "assets" / "anatomy"
PUBLIC = FRONTEND / "public" / "anatomy"

GLBFILE_RE = re.compile(r"glbFile:\s*'([^']+\.glb)'")
REQUIRE_RE = re.compile(r"require\('([^']+\.glb)'\)")


def _gender_dir(gender: str) -> Path:
    return ASSETS / gender


def _asset_files() -> set[str]:
    """All .glb files present under assets/anatomy (relative to anatomy/)."""
    return {
        str(p.relative_to(ASSETS))
        for p in ASSETS.rglob("*.glb")
    }


class TestAnatomyReferencesResolve:
    def test_every_anatomy_map_glb_exists(self):
        map_src = (FRONTEND / "src" / "assets" / "anatomy" / "anatomyMap.ts").read_text()
        referenced = set(GLBFILE_RE.findall(map_src))
        assert referenced, "expected anatomyMap to reference GLB files"

        present = _asset_files()
        missing = {
            f"{('male' if '_male' in f else 'female')}/{f}"
            for f in referenced
            if f"{('male' if '_male' in f else 'female')}/{f}" not in present
        }
        assert not missing, f"anatomyMap references missing GLBs: {missing}"

    def test_every_body_screen_require_resolves(self):
        body_file = FRONTEND / "src" / "screens" / "Body" / "BodyScreen.tsx"
        body_src = body_file.read_text()
        require_paths = REQUIRE_RE.findall(body_src)
        assert require_paths, "expected BodyScreen to require anatomy GLBs"

        # require() paths are relative to the importing file's directory.
        missing = [
            p for p in require_paths if not (body_file.parent / p).resolve().is_file()
        ]
        assert not missing, f"require() paths missing: {missing}"

    def test_meshopt_only_assets_variant_has_no_web_mirror(self):
        # skeletal_male_meshopt.glb is bundled-only (native compression
        # benchmark); it was never served for web downloads.
        present = _asset_files()
        assert "male/skeletal_male_meshopt.glb" in present

    def test_web_mirror_exists_for_every_served_asset(self):
        present = _asset_files()
        mirrored = {
            str(p.relative_to(PUBLIC)) for p in PUBLIC.rglob("*.glb")
        }
        # Every non-meshopt asset must be servable for the web downloader.
        expected = {f for f in present if not f.endswith("_meshopt.glb")}
        # Public tree must not be a superset of assets (would be drift).
        assert expected - mirrored == set()

    def test_dead_placeholder_is_gone_and_unreferenced(self):
        models_dir = FRONTEND / "src" / "assets" / "models"
        assert not models_dir.exists(), "dead anatomy placeholder dir reappeared"
        for ts_file in FRONTEND.rglob("*.tsx"):
            src = ts_file.read_text(errors="ignore")
            assert "assets/models/human_body" not in src, ts_file
        for ts_file in FRONTEND.rglob("*.ts"):
            src = ts_file.read_text(errors="ignore")
            assert "assets/models/human_body" not in src, ts_file

# ---------------------------------------------------------------------------
# rPPG model asset contract (Option 1: frontend-bundled copy is the truth
# the app loads; repo-root rppg_models/ is the canonical training/backend
# copy — the two must never drift).
# ---------------------------------------------------------------------------

RPPG_BUNDLED = FRONTEND / "assets" / "models" / "rppg"
RPPG_CANONICAL = REPO / "rppg_models"
RPPG_REQUIRE_RE = re.compile(r"require\('([^']+\.onnx)'\)")
RPPG_ASSET_CONST_RE = re.compile(r"RPPG_MODEL_ASSET\s*=\s*'([^']+)'")


def _md5(path: Path) -> str:
    import hashlib

    h = hashlib.md5()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


class TestRppgModelAsset:
    def test_bundled_model_exists(self):
        files = list(RPPG_BUNDLED.glob("*.onnx"))
        assert files, f"no .onnx bundled under {RPPG_BUNDLED}"

    def test_filename_matches_RPPG_MODEL_ASSET(self):
        types_src = (FRONTEND / "src" / "services" / "rppg" / "types.ts").read_text()
        m = RPPG_ASSET_CONST_RE.search(types_src)
        assert m, "RPPG_MODEL_ASSET constant missing in rppg/types.ts"
        assert (RPPG_BUNDLED / m.group(1)).is_file(), (
            f"bundled asset {m.group(1)!r} missing under {RPPG_BUNDLED}"
        )

    def test_onnx_require_resolves_inside_frontend(self):
        provider_src = (
            FRONTEND / "src" / "services" / "rppg" / "onnxProvider.ts"
        ).read_text()
        required = RPPG_REQUIRE_RE.findall(provider_src)
        assert required, "expected a static .onnx require in onnxProvider.ts"
        provider_dir = FRONTEND / "src" / "services" / "rppg"
        for rel in required:
            resolved = (provider_dir / rel).resolve()
            assert str(resolved).startswith(str(FRONTEND.resolve())), (
                f"model require escapes the Metro project root: {rel}"
            )
            assert resolved.is_file(), f"required model file missing: {rel}"

    def test_bundled_copy_matches_canonical(self):
        for bundled in RPPG_BUNDLED.glob("*.onnx"):
            canonical = RPPG_CANONICAL / bundled.name
            assert canonical.is_file(), (
                f"bundled {bundled.name} has no canonical twin in rppg_models/"
            )
            assert _md5(bundled) == _md5(canonical), (
                f"drift: frontend copy of {bundled.name} differs from rppg_models/"
            )
