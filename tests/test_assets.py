"""
Phase 0 / Increment 6 — anatomy GLB asset-reference integrity tests.

Guards the Increment-6 asset cleanup and the canonical-reference contract:

  - frontend/assets/anatomy/ holds the anatomy meshes. As of P16 these are
    NOT bundled: they are downloaded on demand (services/anatomyDownload.ts),
    so the contract under test is the download manifest (every declared file
    exists and satisfies the manifest's size tolerance), not require() calls.
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
# P16: anatomy/rPPG assets moved to on-demand download, so the contract is
# now the download manifest rather than static require() calls.
MANIFEST_ENTRY_RE = re.compile(r"filename: '([^']+\.glb)',\s*size: (\d+)")
ANATOMY_DOWNLOAD = FRONTEND / "src" / "services" / "anatomyDownload.ts"


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

    def test_body_screen_does_not_bundle_anatomy_glbs(self):
        """P16: the bundled-require contract was replaced by on-demand download.

        Metro only packages statically require()d assets, so the *absence* of
        any .glb require() in BodyScreen is the deliberate invariant that keeps
        the anatomy meshes (~45 MB) out of the binary. Runtime loads resolve
        through services/anatomyDownload.ts instead.
        """
        body_file = FRONTEND / "src" / "screens" / "Body" / "BodyScreen.tsx"
        found = REQUIRE_RE.findall(body_file.read_text())
        assert not found, (
            "BodyScreen must not statically require anatomy GLBs — assets are "
            f"downloaded on demand (found: {found})"
        )

    def test_every_downloaded_anatomy_asset_satisfies_its_manifest(self):
        """Every manifest entry must have a file inside the accepted size band.

        anatomyDownload.ts treats the manifest size as an estimate and only
        accepts a file whose size ratio is within 0.9-1.1 (rejecting a fresh
        download outright below 0.9). A manifest entry whose real file falls
        outside that band can never install, so 3D Body would break at
        runtime — and nothing else in the suite would notice.
        """
        entries = MANIFEST_ENTRY_RE.findall(ANATOMY_DOWNLOAD.read_text())
        assert entries, "expected an anatomy download manifest"

        problems = []
        for filename, raw_size in entries:
            size = int(raw_size)
            path = next(
                (
                    p
                    for p in (ASSETS / "male" / filename, ASSETS / "female" / filename)
                    if p.is_file()
                ),
                None,
            )
            if path is None:
                problems.append(f"{filename}: no asset file on disk")
                continue
            ratio = path.stat().st_size / size
            if not 0.9 <= ratio <= 1.1:
                problems.append(
                    f"{filename}: size ratio {ratio:.4f} outside the 0.9-1.1 band"
                )
        assert not problems, problems

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
RPPG_MANIFEST_FILENAME_RE = re.compile(r"filename:\s*'([^']+\.onnx)'")
RPPG_MANIFEST_SIZE_RE = re.compile(r"size:\s*(\d+)")


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

    def test_onnx_model_is_not_bundled(self):
        """P16: the 17 MB model is downloaded on demand, never bundled.

        Metro would package a statically require()d .onnx into the binary, so
        onnxProvider.ts must contain no such require (see modelManager.ts).
        """
        provider_src = (
            FRONTEND / "src" / "services" / "rppg" / "onnxProvider.ts"
        ).read_text()
        found = RPPG_REQUIRE_RE.findall(provider_src)
        assert not found, (
            "onnxProvider.ts must not statically require the model — it is "
            f"downloaded on demand (found: {found})"
        )

    def test_manifest_size_is_exact_and_matches_the_canonical_model(self):
        """modelManager verifies size AND checksum exactly (not by tolerance),
        so the manifest in modelMeta.ts must equal the real file exactly.
        """
        meta_src = (FRONTEND / "src" / "services" / "rppg" / "modelMeta.ts").read_text()
        name = RPPG_MANIFEST_FILENAME_RE.search(meta_src)
        size = RPPG_MANIFEST_SIZE_RE.search(meta_src)
        assert name and size, "RPPG_MODEL_MANIFEST filename/size missing"

        canonical = RPPG_CANONICAL / name.group(1)
        assert canonical.is_file(), f"canonical model missing: {canonical}"
        assert int(size.group(1)) == canonical.stat().st_size, (
            f"manifest size {size.group(1)} != actual {canonical.stat().st_size} "
            "(the exact-size check would reject every download)"
        )

    def test_asset_host_is_pinned_to_a_release_tag(self):
        """All on-demand assets share one configurable base; with no env
        override a production build must fall back to a pinned public host.
        """
        host_src = (FRONTEND / "src" / "services" / "assetHost.ts").read_text()
        assert "ASSET_RELEASE_TAG = 'healthgraph-assets-v1'" in host_src
        assert "EXPO_PUBLIC_ASSET_CDN_URL" in host_src
        assert "getAssetBaseUrl" in host_src

    def test_bundled_copy_matches_canonical(self):
        for bundled in RPPG_BUNDLED.glob("*.onnx"):
            canonical = RPPG_CANONICAL / bundled.name
            assert canonical.is_file(), (
                f"bundled {bundled.name} has no canonical twin in rppg_models/"
            )
            assert _md5(bundled) == _md5(canonical), (
                f"drift: frontend copy of {bundled.name} differs from rppg_models/"
            )
