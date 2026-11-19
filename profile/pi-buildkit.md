# Local image builds in Pi

`--buildkit` enables Dockerfile builds, archive exports, and registry pushes through a reusable rootless BuildKit companion. It does not run containers or give Pi the host Docker socket.

## Start

On a Docker-enabled Linux host with working unprivileged user namespaces:

```bash
pi-unleashed-safely --buildkit --rebuild
# Later sessions reuse the image, companion, and cache.
pi-unleashed-safely --buildkit
```

The first launch requires `--rebuild` to install the matching `buildctl` client. Client and companion use BuildKit `v0.20.2`. The real integration checks passed on an AppArmor-enabled host using the named `pi-buildkit` policy.

The companion is `pi-buildkit-<host-uid>`, using the resolved host UID even under sudo. It remains running after Pi exits. Pi connects over `BUILDKIT_HOST=unix:///run/pi-buildkit/buildkitd.sock`. There is no TCP listener or published port. Sessions enabled for the same user share builder state and cache.

## Export an image

Inside Pi, in a directory containing a Dockerfile:

```bash
buildctl build --frontend dockerfile.v0 \
  --local context=. --local dockerfile=. \
  --output type=oci,dest=./image.tar
```

Use `type=docker,dest=./image.tar` for a Docker archive instead. BuildKit exports or pushes during the build. It does not populate a Docker image store for a later `docker push`.

## Authorize registry pushes

`--buildkit` automatically mounts the resolved host user's `~/.docker/config.json` read-only when present, including when launched through sudo. No credentials are mounted without BuildKit enabled. A missing default file is allowed, so local exports still work.

The config must contain standalone `auths` credentials. Host credential helpers and stores are not supported. Use repository-scoped, revocable tokens. To override the default with a dedicated config outside mounted repositories and build contexts, log in using a Docker CLI configured without credential helpers:

```bash
mkdir -p "$HOME/.config/pi-build-registry"
chmod 700 "$HOME/.config/pi-build-registry"
printf '%s' "$REGISTRY_TOKEN" | docker --config "$HOME/.config/pi-build-registry" \
  login registry.example.com --username token-user --password-stdin
chmod 600 "$HOME/.config/pi-build-registry/config.json"

PI_DOCKER_CONFIG_DIR="$HOME/.config/pi-build-registry" \
  pi-unleashed-safely --buildkit
```

Only the selected `config.json` is mounted, read-only at `/run/pi-registry/config.json`. Pi receives `DOCKER_CONFIG=/run/pi-registry`. `PI_DOCKER_CONFIG_DIR` takes precedence over `~/.docker`; the host's `DOCKER_CONFIG` environment variable is ignored. Sibling files and credential helpers are not mounted.

Standalone `auths` credentials are encoded, not encrypted. The agent can read and use them. Enabling BuildKit with a registry config authorizes pushes for the entire session, not individual push approvals. Do not put credentials in Dockerfiles, build arguments, contexts, image layers, command output, or logs. Review `.dockerignore` before building.

Inside Pi:

```bash
buildctl build --frontend dockerfile.v0 \
  --local context=. --local dockerfile=. \
  --output type=image,name=registry.example.com/team/app:dev,push=true
```

## Security and host limits

The daemon runs as UID 1000 inside its companion. A short-lived, non-privileged root initializer sets named-volume ownership. Socket mode 0666 permits Pi's arbitrary UID to connect without host group membership. The socket is accessible only to containers mounting that volume and to the Docker administrator. It grants full access to the shared builder, not just permission to build one repository.

The companion uses BuildKit's documented `seccomp=unconfined`, `apparmor=unconfined`, and `systempaths=unconfined` settings. The native snapshotter avoids requiring `/dev/fuse`. It retains BuildKit's process sandbox. Rootless BuildKit shares the host kernel and relaxes container security restrictions. It is not VM-level isolation.

The wrapper never changes host sysctls or falls back to privileged execution. Unsupported user namespaces, kernel restrictions, or security settings cause startup to fail before Pi starts. Startup diagnostics include daemon logs and state. The readiness loop has up to 30 attempts with one-second connection timeouts and stops early when the companion exits. Docker daemon operations can take additional time.

### AppArmor user-namespace exception

Ubuntu's restricted unprivileged user namespaces can block RootlessKit even with `apparmor=unconfined`. On hosts with AppArmor enabled and the AppArmor 4 ABI available, `install` copies `profile/apparmor/pi-buildkit` to `/etc/apparmor.d/pi-buildkit` with root ownership and mode 0644. It loads the policy with `apparmor_parser -r`, without restarting AppArmor. The AppArmor service loads the installed file again at boot. Unsupported or disabled AppArmor installations are skipped; a policy loading failure fails installation.

The wrapper and integration test automatically select `pi-buildkit` when this installed file exists. `PI_BUILDKIT_APPARMOR_PROFILE` can override the selection, for example when using a remote Docker host.

The policy grants `userns` to an explicitly named companion profile, without disabling the host-wide restriction or changing Docker's default profile. It otherwise uses AppArmor's unconfined mode, matching the existing BuildKit security setting. This is not an additional confinement policy.

The named profile avoids relying on a host executable path to identify a binary inside a container. Docker must explicitly select it. To test it temporarily before running the installer, on the Docker host from this repository:

```bash
# Load into the running kernel only. This does not install a persistent policy.
sudo apparmor_parser -r profile/apparmor/pi-buildkit

# Exercise real builds, cache, exports, and authenticated pushes with the policy.
PI_BUILDKIT_APPARMOR_PROFILE=pi-buildkit \
  bash tests/pi-buildkit-integration-test.sh
```

This requires AppArmor 4 policy support. Do not disable the global user-namespace restriction if parsing or testing fails. Capture the error and relevant AppArmor denial from the host's kernel log instead.

After installing the policy, first stop enabled sessions and remove any old companion so its immutable Docker security options can change. Cache volumes remain intact:

```bash
docker rm -f "pi-buildkit-$(id -u)"
./profile/pi-unleashed-safely.sh --buildkit --rebuild
```

If you only loaded the repository file temporarily, continue using `PI_BUILDKIT_APPARMOR_PROFILE=pi-buildkit` until running `install`. That temporary load does not survive reboot. To unload a temporary policy after removing test companions, run `sudo apparmor_parser -R profile/apparmor/pi-buildkit`.

`--docker-host` remains a separate, privileged Docker-in-Docker option. It can be combined with `--buildkit`, but it is not needed for builds. Credential helpers, multi-platform emulation, and container execution through BuildKit are not supported.

## Cache and companion maintenance

From the host, after stopping enabled sessions:

```bash
uid="$(id -u)"
# Stop without discarding cache. The next enabled launch restarts it.
docker stop "pi-buildkit-$uid"

# Remove the companion, for example after changing the pinned release.
docker rm -f "pi-buildkit-$uid"

# Also discard persistent cache and the socket volume.
docker volume rm "pi-buildkit-$uid-state" "pi-buildkit-$uid-socket"
```

Run `buildctl du` and `buildctl prune` inside an enabled session to inspect or prune unused cache without removing the companion. Cache and build history may contain source files or build outputs. Do not treat separate sessions for one UID as isolated tenants.

## Validation

```bash
bash tests/pi-unleashed-safely-test.sh
bash tests/run-ci-checks.sh
bash tests/pi-buildkit-integration-test.sh
```

The integration test requires a reachable local Docker daemon, internet access, and Python 3. It builds a Dockerfile with `RUN` and `COPY` through the Unix socket from UID 12345, checks OCI archive contents and cache reuse after restart, inspects container isolation, and tests rejected and authorized pushes plus retrieval through a disposable authenticated registry. No ports are published and no production tags are used. Test-only HTTP credentials are used on the disposable Docker network. Real registry usage should use HTTPS.

Rootless settings follow [BuildKit's rootless documentation](https://github.com/moby/buildkit/blob/v0.20.2/docs/rootless.md).
