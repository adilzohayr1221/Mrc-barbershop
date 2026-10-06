# Deploying to Vercel

Manual file-based deploys (no git connected). The `vercel` CLI tool's
`upload_file` takes base64 via `--arguments-json`, which has a ~128KB
per-argument limit, so:

- `package-lock.json` is intentionally NOT deployed (Vercel runs `npm install`
  at build time). `public/logo.jpg` was re-encoded to ~49KB to fit.
- Files over ~95KB raw cannot be uploaded this way.

## Redeploy after code changes

```bash
cd ~/workspace/mrc-barbershop
# 1. upload each changed file, update the manifest + deploy args
python3 - <<'EOF'
import base64, hashlib, json, subprocess
changed = ['src/lib/blob.ts']  # <-- edit this list
m = json.load(open('/tmp/mrc_deploy_manifest.json'))
for p in changed:
    data = open(p, 'rb').read()
    size = len(data); sha = hashlib.sha1(data).hexdigest()
    args = {"contentLength": size, "xVercelDigest": sha,
            "requestBody": base64.b64encode(data).decode()}
    r = subprocess.run(["vercel", "call-tool", "--name", "upload_file",
                        "--arguments-json", json.dumps(args)],
                       capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stderr[-300:]
    m = [e for e in m if e['file'] != p]
    m.append({"file": p, "sha": sha, "size": size})
m.sort(key=lambda e: e['file'])
json.dump(m, open('/tmp/mrc_deploy_manifest.json', 'w'))
body = {'project': 'prj_XwUMLWCAXpOKGJK705ch9LrpZzWc', 'name': 'mrc-barbershop',
        'target': 'production', 'files': m,
        'projectSettings': {'framework': 'nextjs'}}
json.dump({'requestBody': body, 'skipAutoDetectionConfirmation': '1'},
          open('/tmp/deploy_args.json', 'w'))
print('ready:', len(m), 'files')
EOF
# 2. create the deployment
vercel call-tool --name create_deployment --arguments-json "$(cat /tmp/deploy_args.json)"
```

## Gotchas learned

- Private Blob store: `head()` returns `url` which 403s for private blobs.
  Always `fetch(meta.url, { headers: { Authorization: 'Bearer ' + process.env.BLOB_READ_WRITE_TOKEN } })`
  server-side. OIDC (`oidcToken` + `storeId`) works for `put`/`head`/`list`/`del`.
- API routes reading the store MUST export `const dynamic = 'force-dynamic'`
  or Next.js may statically prerender them at build time.
- `seed.ts` `ensureSeeded()` is called by the API routes and by
  `getBranches`/`getBarbers`/`getServices`/`getPins` in `store.ts`.
- `create_deployment` needs `skipAutoDetectionConfirmation` as the STRING "1".
- `get_deployment`/`list_deployment_events` fail with 403 if you pass
  `teamId`/`slug` — call them WITHOUT those params.
- Env vars on the project: `BLOB_STORE_ID`, `SESSION_SECRET` (production),
  plus auto-created `BLOB_READ_WRITE_TOKEN`.
- SSO/deployment protection was disabled via `update_project`
  (`ssoProtection: null`) so the public URL works without Vercel login.
- Blob `list()` is eventually consistent — new blobs may lag in listings;
  direct `getDoc` reads of new paths are consistent immediately. Customer
  bookings API accepts `?include=<id>` to merge a just-created booking via
  direct read so it never "disappears" after booking.

Live URL: https://mrc-barbershop-mrc-0043.vercel.app
