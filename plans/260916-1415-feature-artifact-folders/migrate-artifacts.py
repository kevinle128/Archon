"""Apply the reviewed artifact move map and check preserved local references."""

import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

PLAN = Path(__file__).parent
TOKEN = re.compile(r"(?<![\w./-])(?:/?[\w.-]+/)*[\w.-]+\.(?:md|yaml|yml|json|toml|py|mjs|sh|html|png|svg|excalidraw|manifest)\b|(?<![\w./-])(?:/?[\w.-]+/)+[\w.-]+/?")
OWNED = {"_bmad-output", "docs", "plans", "brain", "scripts", "design-artifacts"}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def collect(root):
    tracked = subprocess.check_output(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=root
    ).decode().split("\0")
    paths = {root / p for p in tracked if p}
    paths.update((root / "_bmad-output").rglob("*"))
    paths.update((root / "_bmad/custom").glob("*"))
    return sorted(p for p in paths if (p.is_file() or p.is_symlink()) and (
        p.relative_to(root).parts[0] in OWNED
        or str(p.relative_to(root)).startswith("_bmad/custom/")
        or len(p.relative_to(root).parts) == 1
    ) and p.name != ".DS_Store" and p.name != "CHANGELOG.md"
        and ".generated." not in p.name and "__pycache__" not in p.parts)


def prepare(project, backup=None):
    root = Path(project["root"])
    moves = [(root / a, root / b) for a, b in project["moves"].items()]

    def mapped(path):
        path = Path(os.path.normpath(path))
        for source, target in moves:
            if path == source or source in path.parents:
                return target / path.relative_to(source)
        return path

    for source, target in moves:
        if not source.exists() and not source.is_symlink():
            assert backup is not None and target.exists(), source
        else:
            assert not target.exists() and not target.is_symlink(), target
    records = []
    sources = collect(root)
    saved_root = backup / root.name if backup else None
    if saved_root and saved_root.exists():
        sources = [saved for saved in saved_root.rglob('*') if saved.is_file() or saved.is_symlink()]
        sources = [root / saved.relative_to(saved_root) for saved in sources]
    for source in sources:
        target = mapped(source)
        saved = saved_root / source.relative_to(root) if saved_root else None
        read_from = saved if saved and (saved.exists() or saved.is_symlink()) else source
        if read_from.is_symlink():
            original = os.readlink(read_from)
            destination = mapped(source.parent / original)
            after = os.path.relpath(destination, target.parent)
            records.append(dict(source=source, target=target, before=original,
                                after=after, links=[], symlink=True))
            continue
        before = read_from.read_bytes()
        links = []
        try:
            text = before.decode("utf-8")
        except UnicodeDecodeError:
            records.append(dict(source=source, target=target, before=before,
                                after=before, links=[], symlink=False))
            continue

        def replace(match):
            token = match.group()
            raw = Path(token)
            if raw.is_absolute():
                candidates = [(raw, "absolute")]
            else:
                candidates = [(source.parent / raw, "relative"), (root / raw, "root"),
                              (root / "_bmad-output/planning-artifacts" / raw, "planning")]
                if token.startswith(("_bmad-output/", "_bmad/", "docs/", "plans/", "scripts/", "brain/")):
                    candidates[0], candidates[1] = candidates[1], candidates[0]
            for candidate, style in candidates:
                candidate = Path(os.path.normpath(candidate))
                if not candidate.exists() and not (backup and mapped(candidate).exists()):
                    continue
                new_path = mapped(candidate)
                if new_path == candidate and (target == source or style != "relative"):
                    return token
                if style == "absolute":
                    updated = str(new_path)
                elif style in {"root", "planning"}:
                    updated = os.path.relpath(new_path, root)
                else:
                    updated = os.path.relpath(new_path, target.parent)
                if token.endswith("/"):
                    updated += "/"
                links.append((updated, new_path, style))
                return updated
            return token

        after = TOKEN.sub(replace, text).encode("utf-8")
        records.append(dict(source=source, target=target, before=before,
                            after=after, links=links, symlink=False))
    assert len({r["target"] for r in records}) == len(records)
    return root, moves, records


def main():
    backup = Path(sys.argv[sys.argv.index('--resume') + 1]) if '--resume' in sys.argv else None
    projects = [prepare(p, backup) for p in json.loads((PLAN / "moves.json").read_text())]
    for root, moves, records in projects:
        print(f"{root.name}: {len(moves)} moves, "
              f"{sum(r['source'] != r['target'] for r in records)} files relocated, "
              f"{sum(r['before'] != r['after'] for r in records)} reference edits")
    if "--apply" not in sys.argv:
        return
    backup = backup or Path(tempfile.mkdtemp(prefix="bmad-feature-folders-"))
    evidence = {"backup": str(backup), "projects": []}
    for root, moves, records in projects:
        project = {"root": str(root), "files": []}
        for r in records:
            if r["before"] != r["after"] or r["source"] != r["target"]:
                saved = backup / root.name / r["source"].relative_to(root)
                if saved.exists() or saved.is_symlink():
                    continue
                saved.parent.mkdir(parents=True, exist_ok=True)
                if r["symlink"]:
                    saved.symlink_to(r["before"])
                else:
                    saved.write_bytes(r["before"])
        for source, target in moves:
            if not source.exists() and not source.is_symlink():
                assert target.exists(), target
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            source.rename(target)
        for r in records:
            target = r["target"]
            if r["before"] == r["after"] and r["source"] == target:
                continue
            current = os.readlink(target) if r["symlink"] else target.read_bytes()
            assert current in (r["before"], r["after"]), f'Concurrent edit: {target}'
            if r["before"] != r["after"]:
                if r["symlink"]:
                    temporary = target.with_name(target.name + ".relocated-link")
                    assert not temporary.exists() and not temporary.is_symlink()
                    temporary.symlink_to(r["after"])
                    temporary.replace(target)
                else:
                    target.write_bytes(r["after"])
            actual = os.readlink(target) if r["symlink"] else target.read_bytes()
            assert actual == r["after"], target
            for token, expected, style in r["links"]:
                resolved = Path(token) if style == "absolute" else (
                    root / token if style in {"root", "planning"} else target.parent / token)
                assert Path(os.path.normpath(resolved)) == expected, (target, token)
                assert expected.exists(), (target, token)
            if r["symlink"]:
                assert target.exists(), target
            project["files"].append({
                "before": str(r["source"].relative_to(root)),
                "after": str(target.relative_to(root)),
                "sha256_before": digest(r["before"].encode() if r["symlink"] else r["before"]),
                "sha256_after": digest(r["after"].encode() if r["symlink"] else r["after"]),
                "updated_links": len(r["links"]),
            })
        evidence["projects"].append(project)
    (PLAN / "migration-evidence.json").write_text(json.dumps(evidence, indent=2) + "\n")
    print(f"All relocated content and updated links verified. Original copies: {backup}")


if __name__ == "__main__":
    main()
