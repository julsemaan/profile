---
name: kind-clusters
description: Access kind Kubernetes clusters from the Pi sandbox
---

# Access kind clusters

Sandbox loopback is not host loopback. A host kubeconfig pointing at
`127.0.0.1` or `localhost` cannot reach the host API server from the sandbox.
Use a trusted kubeconfig accessible through a mount. If none is mounted,
ask the user to provide one before proceeding.

## Connect without changing the kubeconfig

Identify the cluster and selected context from the kubeconfig first:

```bash
src=/path/to/mounted/kubeconfig.yaml
kubectl --kubeconfig="$src" config get-contexts
```

Set the actual kind cluster name explicitly. For example, context
`kind-demo` normally refers to kind cluster `demo`. Select the intended
context with `--context` on every command if it is not the current one.

```bash
cluster=your-cluster-name

kubectl --kubeconfig="$src" \
  --server="https://${cluster}-control-plane:6443" \
  --request-timeout=10s get nodes
```

Keep TLS verification enabled and leave the source kubeconfig unchanged.
Do not use `--insecure-skip-tls-verify` or rewrite its server field.
For custom node names or endpoints, confirm the API endpoint with the user
or host-side configuration rather than guessing.

## Troubleshoot access

- Check node DNS with `getent hosts "${cluster}-control-plane"`.
- `pi-unleashed-safely` joins the host Docker network named `kind` when it
  exists. Its network attachment change must ship before or with this skill.
  If DNS fails, confirm that network exists and restart the sandbox through
  the updated wrapper.
- `--docker-host` uses a separate Docker daemon and private network, not the
  host's `kind` network. Do not use it for access to host kind clusters.
- For services, use reachable node DNS plus the service's NodePort, or run
  `kubectl port-forward` with the same kubeconfig, context, and server flags.
  A forward started inside the sandbox listens on sandbox loopback.
- A local registry's host `localhost` URL is not reachable as sandbox
  `localhost`. Confirm its reachable container DNS name and internal port.
  Registry access from the sandbox and image pulls by kind nodes are separate.
- Keep host-cluster lifecycle operations on the host. The sandbox's Docker
  daemon, if enabled, does not manage the host's kind cluster.
- Keep kubectl within one minor version older or newer than the API server.

## Verify

Run `/reload`, then `/skill:kind-clusters` to check discovery. Run the node
query above against the live cluster with TLS verification enabled. Compare
`sha256sum "$src"` before and after to confirm the kubeconfig is unchanged.
