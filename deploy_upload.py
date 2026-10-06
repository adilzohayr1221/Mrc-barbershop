#!/usr/bin/env python3
"""Upload project files to Vercel (content-addressed by SHA1) and save a deployment manifest."""
import base64, hashlib, json, os, subprocess, sys

PROJECT_DIR = os.path.expanduser("~/workspace/mrc-barbershop")
SKIP = {"node_modules", ".next", ".git", "AGENTS.md", "CLAUDE.md", "package-lock.json", "deploy_upload.py", "tsconfig.tsbuildinfo"}
MANIFEST = "/tmp/mrc_deploy_manifest.json"

def call_upload(size, digest, b64):
    args = {"contentLength": size, "xVercelDigest": digest, "requestBody": b64}
    p = subprocess.run(
        ["vercel", "call-tool", "--name", "upload_file",
         "--arguments-json", json.dumps(args)],
        capture_output=True, text=True, timeout=120)
    if p.returncode != 0:
        return False, p.stderr[-500:]
    try:
        d = json.loads(p.stdout)
        # success if no isError
        if d.get("isError"):
            return False, p.stdout[-500:]
    except Exception:
        pass
    return True, ""

def main():
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
    manifest = []
    failed = []
    for rel in files:
        full = os.path.join(PROJECT_DIR, rel)
        with open(full, "rb") as f:
            data = f.read()
        size = len(data)
        sha = hashlib.sha1(data).hexdigest()
        b64 = base64.b64encode(data).decode()
        ok, err = call_upload(size, sha, b64)
        print(("OK  " if ok else "FAIL") + f" {rel} ({size}B sha={sha[:10]}…)" + ("" if ok else f" :: {err}"))
        if ok:
            manifest.append({"file": rel, "sha": sha, "size": size})
        else:
            failed.append(rel)
    with open(MANIFEST, "w") as f:
        json.dump(manifest, f)
    print(f"\nUploaded {len(manifest)}/{len(files)}. Manifest: {MANIFEST}")
    if failed:
        print("FAILED:", failed)
        sys.exit(1)

if __name__ == "__main__":
    main()
