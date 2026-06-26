# 40-kube-and-ux.bash - Kubernetes helpers, kubectl completion
#
# This file is sourced by the jprofile loader (profile/.bashrc_append).
# Edit in the repo; install copies to /usr/local/etc/bashrc.d/.

# --- kubectl completion ---
if command -v kubectl >/dev/null 2>&1; then
  eval "$(kubectl completion bash)"
  if command -v kubecolor >/dev/null 2>&1; then
    alias kubectl='kubecolor'
    complete -o default -F __start_kubectl kubecolor
  fi
  alias k='kubectl'
  complete -o default -F __start_kubectl kubectl
  complete -o default -F __start_kubectl k
fi

# --- klogs_deploy ---
# Usage: klogs_deploy <deployment-name> [k logs args...]
klogs_deploy() {
  local deploy="$1"
  shift || true

  if [[ -z "$deploy" ]]; then
    echo "Usage: klogs_deploy <deployment-name> [k logs args...]"
    return 1
  fi

  local ns
  ns="$(k get deploy -A --no-headers 2>/dev/null | awk -v d="$deploy" '$2==d {print $1}')"

  if [[ -z "$ns" ]]; then
    echo "Deployment '$deploy' not found in any namespace"
    return 1
  fi

  if [[ "$(echo "$ns" | wc -l)" -gt 1 ]]; then
    echo "Deployment '$deploy' exists in multiple namespaces:"
    echo "$ns"
    echo "Please disambiguate."
    return 1
  fi

  local selector
  # shellcheck disable=SC2016
  selector="$(k get deploy "$deploy" -n "$ns" -o go-template='{{range $k, $v := .spec.selector.matchLabels}}{{printf "%s=%s," $k $v}}{{end}}')"
  selector="${selector%,}"

  if [[ -z "$selector" ]]; then
    echo "Could not determine selector for deployment '$deploy' in namespace '$ns'"
    return 1
  fi

  local pod
  pod="$(k get pods -n "$ns" -l "$selector" -o jsonpath='{.items[0].metadata.name}')"

  if [[ -z "$pod" ]]; then
    echo "No pods found for deployment '$deploy' in namespace '$ns'"
    return 1
  fi

  k logs -n "$ns" "$pod" "$@"
}
