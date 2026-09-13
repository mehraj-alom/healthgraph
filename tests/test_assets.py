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