#!/usr/bin/env python3
"""Parallel Vercel file upload (resilient). Usage: upload_worker.py <part> <nparts>"""
import base64, hashlib, json, os, subprocess, sys

PROJECT_DIR = os.path.expanduser("~/workspace/mrc-barbershop")
SKIP = {"node_modules", ".next", ".git", ".open-next", "AGENTS.md", "CLAUDE.md",
        "package-lock.json", "deploy_upload.py", "upload_worker.py", "tsconfig.tsbuildinfo"}
MANIFEST = "/tmp/mrc_deploy_manifest.json"

def call_upload(size, digest, b64):
    args = {"contentLength": size, "xVercelDigest": digest, "requestBody": b64}
    try:
        p = subprocess.run(
            ["vercel", "call-tool", "--name", "upload_file",
             "--arguments-json", json.dumps(args)],
            capture_output=True, text=True, timeout=180)
        return p.returncode == 0, "" if p.returncode == 0 else p.stderr[-200:]
    except OSError as e:
        return False, f"OSError {e}"

def main():
    part, nparts = int(sys.argv[1]), int(sys.argv[2])
    done = {}
    try:
        for e in json.load(open(MANIFEST)):
            done[e["file"]] = e["sha"]
    except FileNotFoundError:
        pass
    files = []
    for root, dirs, names in os.walk(PROJECT_DIR):
        dirs[:] = [d for d in dirs if d not in SKIP]
        for n in names:
            if n in SKIP:
                continue
            full = os.path.join(root, n)
            rel = os.path.relpath(full, PROJECT_DIR)
            files.append(rel)
    files.sort()
    mine = [f for i, f in enumerate(files) if i % nparts == part]
    manifest, failed, skipped = [], [], 0
    for rel in mine:
        full = os.path.join(PROJECT_DIR, rel)
        with open(full, "rb") as fh:
            data = fh.read()
        sha = hashlib.sha1(data).hexdigest()
        if done.get(rel) == sha:
            skipped += 1
            manifest.append({"file": rel, "sha": sha, "size": len(data)})
            continue
        ok, err = call_upload(len(data), sha, base64.b64encode(data).decode())
        if ok:
            manifest.append({"file": rel, "sha": sha, "size": len(data)})
        else:
            failed.append((rel, err))
    with open(f"/tmp/manifest_part_{part}.json", "w") as fh:
        json.dump(manifest, fh)
    print(f"part {part}: {len(manifest)}/{len(mine)} ok, {skipped} skipped" +
          (f" FAILED: {failed}" if failed else ""))
    sys.exit(1 if failed else 0)

if __name__ == "__main__":
    main()
