#!/usr/bin/env bash
# Real Docker integration test. Requires a local daemon, internet, and rootless user namespaces.
# Test-only HTTP registry credentials never leave the disposable, unpublished Docker network.
set -euo pipefail

function fail {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

for tool in docker python3; do
  command -v "$tool" >/dev/null || fail "$tool is required"
done
docker info >/dev/null 2>&1 || fail 'Docker daemon is unavailable'

apparmor_profile="${PI_BUILDKIT_APPARMOR_PROFILE:-unconfined}"
if [[ -z "${PI_BUILDKIT_APPARMOR_PROFILE:-}" && -f /etc/apparmor.d/pi-buildkit ]]; then
  apparmor_profile=pi-buildkit
fi
image=moby/buildkit:v0.20.2-rootless
tmp="$(mktemp -d "${TMPDIR:-/tmp}/pi-buildkit-test.XXXXXXXXXX")"
prefix="$(basename "$tmp" | tr '[:upper:].' '[:lower:]-')"
daemon="$prefix-daemon"
registry="$prefix-registry"
network="$prefix-network"
state="$prefix-state"
socket="$prefix-socket"
containers=()
sequence=0

function cleanup {
  local status=$?
  trap - EXIT INT TERM
  if ((status != 0)); then
    docker logs "$daemon" >&2 2>/dev/null || true
    docker logs "$registry" >&2 2>/dev/null || true
  fi
  if ((${#containers[@]})); then
    docker rm -fv "${containers[@]}" >/dev/null 2>&1 || true
  fi
  docker volume rm "$state" "$socket" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  rm -rf -- "$tmp"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Track even interrupted/failed docker run calls, including short-lived clients.
function run {
  sequence=$((sequence + 1))
  local name="$prefix-client-$sequence"
  containers+=("$name")
  docker run --name "$name" --rm "$@"
}

mkdir -p "$tmp/context" "$tmp/output" "$tmp/empty-auth" "$tmp/auth" "$tmp/registry-auth"
chmod 755 "$tmp" "$tmp/context" "$tmp/empty-auth" "$tmp/auth" "$tmp/registry-auth"
chmod 777 "$tmp/output"
printf 'COPY reached the image\n' >"$tmp/context/expected"
cat >"$tmp/context/Dockerfile" <<'EOF'
FROM alpine:3.21
RUN cat /proc/sys/kernel/random/uuid > /run-proof
COPY expected /copied-proof
EOF
chmod -R a+rX "$tmp/context"

# HTTP is enabled only for this registry, never globally or for public registries.
cat >"$tmp/buildkitd.toml" <<EOF
[registry."$registry:5000"]
  http = true
EOF
chmod 644 "$tmp/buildkitd.toml"
# Disposable credentials, unrelated to the user's Docker config.
python3 - "$registry:5000" "$tmp/auth/config.json" <<'PY'
import base64, json, sys
with open(sys.argv[2], 'w') as f:
    json.dump({'auths': {sys.argv[1]: {
        'auth': base64.b64encode(b'buildkit-test:buildkit-test-password').decode()
    }}}, f)
PY
chmod 644 "$tmp/auth/config.json"
printf '{"auths":{}}\n' >"$tmp/empty-auth/config.json"
# Root cannot overwrite the opted-in file either, because the mount itself is read-only.
run --user 0:0 --entrypoint sh \
  --mount "type=bind,src=$tmp/auth/config.json,dst=/run/pi-registry/config.json,readonly" \
  "$image" -ec 'test -r /run/pi-registry/config.json; if echo overwrite 2>/dev/null > /run/pi-registry/config.json; then exit 1; fi'
run --entrypoint htpasswd httpd:2-alpine -Bbn buildkit-test buildkit-test-password >"$tmp/registry-auth/htpasswd"
chmod 644 "$tmp/registry-auth/htpasswd"

docker network create "$network" >/dev/null
docker volume create "$state" >/dev/null
docker volume create "$socket" >/dev/null
run --user 0:0 --entrypoint sh \
  --mount "type=volume,src=$state,dst=/home/user/.local/share/buildkit" \
  --mount "type=volume,src=$socket,dst=/run/pi-buildkit" \
  "$image" -ec 'chown 1000:1000 /home/user/.local/share/buildkit /run/pi-buildkit; chmod 755 /run/pi-buildkit'

containers+=("$registry")
docker run -d --name "$registry" --network "$network" \
  --mount "type=bind,src=$tmp/registry-auth,dst=/auth,readonly" \
  -e REGISTRY_AUTH=htpasswd -e REGISTRY_AUTH_HTPASSWD_REALM=buildkit-test \
  -e REGISTRY_AUTH_HTPASSWD_PATH=/auth/htpasswd registry:2 >/dev/null

# https://github.com/moby/buildkit/blob/v0.20.2/docs/rootless.md
# Match the wrapper's rootless settings, including a native snapshotter without /dev/fuse.
containers+=("$daemon")
docker run -d --name "$daemon" --network "$network" --user 1000:1000 \
  --security-opt seccomp=unconfined --security-opt "apparmor=$apparmor_profile" \
  --security-opt systempaths=unconfined \
  --mount "type=volume,src=$state,dst=/home/user/.local/share/buildkit" \
  --mount "type=volume,src=$socket,dst=/run/pi-buildkit" \
  --mount "type=bind,src=$tmp/buildkitd.toml,dst=/etc/buildkit/buildkitd.toml,readonly" \
  "$image" --addr unix:///run/pi-buildkit/buildkitd.sock \
  --config /etc/buildkit/buildkitd.toml \
  --oci-worker-snapshotter=native >/dev/null

function client {
  local auth=$1
  shift
  run --network "$network" --user 12345:12345 --entrypoint buildctl \
    -e DOCKER_CONFIG=/run/pi-registry -e TMPDIR=/tmp \
    --mount "type=volume,src=$socket,dst=/run/pi-buildkit,readonly" \
    --mount "type=bind,src=$tmp/context,dst=/context,readonly" \
    --mount "type=bind,src=$tmp/output,dst=/output" \
    --mount "type=bind,src=$tmp/$auth/config.json,dst=/run/pi-registry/config.json,readonly" \
    "$image" --addr unix:///run/pi-buildkit/buildkitd.sock --timeout 120 "$@"
}

function ready {
  local attempt
  for ((attempt = 1; attempt <= 60; attempt++)); do
    if docker exec --user 1000:1000 "$daemon" sh -ec \
      'test -S /run/pi-buildkit/buildkitd.sock && chmod 666 /run/pi-buildkit/buildkitd.sock' 2>/dev/null; then
      if client empty-auth debug workers >"$tmp/workers" 2>&1 && [[ -s $tmp/workers ]]; then
        return
      fi
    fi
    sleep 1
  done
  fail 'BuildKit did not become ready for UID 12345'
}

function inspect_isolation {
  docker inspect "$daemon" "$registry" | python3 -c '
import json, sys
for container in json.load(sys.stdin):
    host = container["HostConfig"]
    assert not host["Privileged"], "privileged container"
    for key in ("NetworkMode", "PidMode", "IpcMode", "UTSMode", "UsernsMode", "CgroupnsMode"):
        assert host.get(key) != "host", key + " uses host namespace"
    assert not host.get("PortBindings"), "published ports"
    assert not any(container["NetworkSettings"].get("Ports", {}).values()), "published ports"
    assert not host.get("PublishAllPorts"), "publish-all enabled"
    if container["Name"].endswith("-daemon"):
        assert container["Config"]["User"] == "1000:1000", "daemon is not UID 1000"
        assert not any(m["Source"] == "/var/run/docker.sock" for m in container["Mounts"])
'
}

function build {
  local auth=$1
  shift
  client "$auth" build --progress plain --frontend dockerfile.v0 \
    --local context=/context --local dockerfile=/context "$@"
}

# Read OCI descriptors and layers without unpacking an untrusted archive onto the host.
function verify_archive {
  python3 - "$tmp/output/$1" <<'PY'
import io, json, sys, tarfile, uuid
with tarfile.open(sys.argv[1]) as archive:
    def blob(descriptor):
        algo, digest = descriptor['digest'].split(':', 1)
        return archive.extractfile('blobs/' + algo + '/' + digest).read()
    manifest = json.load(archive.extractfile('index.json'))
    while 'manifests' in manifest:
        manifest = json.loads(blob(manifest['manifests'][0]))
    files = {}
    for layer in manifest['layers']:
        with tarfile.open(fileobj=io.BytesIO(blob(layer)), mode='r:*') as contents:
            for member in contents:
                name = member.name.removeprefix('./').lstrip('/')
                if name in ('run-proof', 'copied-proof') and member.isfile():
                    files[name] = contents.extractfile(member).read()
    assert files['copied-proof'] == b'COPY reached the image\n', files
    proof = files['run-proof'].decode().strip()
    uuid.UUID(proof)
    print(proof)
PY
}

ready
inspect_isolation
build empty-auth --output type=oci,dest=/output/first.tar
verify_archive first.tar >"$tmp/first-proof"

# The random RUN output must remain unchanged after the daemon process restarts.
docker stop -t 20 "$daemon" >/dev/null
docker start "$daemon" >/dev/null
ready
build empty-auth --output type=oci,dest=/output/restarted.tar >"$tmp/restarted.log" 2>&1 || {
  cat "$tmp/restarted.log" >&2
  fail 'build after daemon restart failed'
}
cat "$tmp/restarted.log"
verify_archive restarted.tar >"$tmp/restarted-proof"
cmp "$tmp/first-proof" "$tmp/restarted-proof" || fail 'RUN cache did not survive daemon restart'
grep -q 'CACHED' "$tmp/restarted.log" || fail 'restart build reported no cache hits'

# Wait for an actual authentication challenge, not an arbitrary startup delay.
# shellcheck disable=SC2016 # $1 is the registry argument inside the container.
run --network "$network" --entrypoint sh "$image" -ec '
  for attempt in $(seq 1 60); do
    if wget -S -O /dev/null "http://$1:5000/v2/" 2>&1 | grep -q "401 Unauthorized"; then exit 0; fi
    sleep 1
  done
  exit 1
' sh "$registry" || fail 'registry did not require authentication'

output="type=image,name=$registry:5000/buildkit-test:integration,push=true,registry.insecure=true"
if build empty-auth --output "$output" >"$tmp/unauthenticated.log" 2>&1; then
  fail 'unauthenticated push unexpectedly succeeded'
fi
grep -Eiq 'unauthorized|authentication required|no basic auth credentials|401' "$tmp/unauthenticated.log" || {
  cat "$tmp/unauthenticated.log" >&2
  fail 'unauthenticated push failed for a reason other than authentication'
}
build auth --output "$output"
printf 'FROM %s:5000/buildkit-test:integration\n' "$registry" >"$tmp/context/Dockerfile"
build auth --opt image-resolve-mode=pull --output type=oci,dest=/output/retrieved.tar
verify_archive retrieved.tar >"$tmp/retrieved-proof"
cmp "$tmp/first-proof" "$tmp/retrieved-proof" || fail 'retrieved image differs from the pushed image'
inspect_isolation
printf 'PASS: rootless BuildKit, arbitrary UID, OCI RUN/COPY, persistent cache, isolation, registry authentication and retrieval\n'
