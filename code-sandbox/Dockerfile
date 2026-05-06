FROM node:25-bookworm

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    clang-format \
    ncurses-term \
    tmux \
    vim \
    wl-clipboard \
    xauth \
    xclip \
    xsel \
 && rm -rf /var/lib/apt/lists/*

RUN /bin/bash -euo pipefail -c '\
GO_VERSION="$(curl -fsSL https://go.dev/VERSION?m=text | head -n1)"; \
ARCH="$(dpkg --print-architecture)"; \
case "$ARCH" in \
  amd64|arm64) GO_ARCH="$ARCH" ;; \
  *) echo "Unsupported architecture for Go: $ARCH" >&2; exit 1 ;; \
esac; \
curl -fsSL "https://go.dev/dl/${GO_VERSION}.linux-${GO_ARCH}.tar.gz" -o /tmp/go.tgz; \
rm -rf /usr/local/go; \
tar -C /usr/local -xzf /tmp/go.tgz; \
rm /tmp/go.tgz; \
ln -sf /usr/local/go/bin/go /usr/local/bin/go; \
ln -sf /usr/local/go/bin/gofmt /usr/local/bin/gofmt \
'

RUN /bin/bash -euo pipefail -c '\
ARCH="$(dpkg --print-architecture)"; \
case "$ARCH" in \
  amd64) KUBE_ARCH="amd64"; HELM_ARCH="amd64"; RG_ARCH="x86_64-unknown-linux-musl" ;; \
  arm64) KUBE_ARCH="arm64"; HELM_ARCH="arm64"; RG_ARCH="aarch64-unknown-linux-gnu" ;; \
  *) echo "Unsupported architecture for kubectl/helm/rg: $ARCH" >&2; exit 1 ;; \
esac; \
KUBE_VERSION="$(curl -fsSL https://dl.k8s.io/release/stable.txt)"; \
curl -fsSL "https://dl.k8s.io/release/${KUBE_VERSION}/bin/linux/${KUBE_ARCH}/kubectl" -o /usr/local/bin/kubectl; \
chmod +x /usr/local/bin/kubectl; \
HELM_VERSION="$(curl -fsSL -o /dev/null -w "%{url_effective}" https://github.com/helm/helm/releases/latest | sed -n "s#.*/tag/##p")"; \
curl -fsSL "https://get.helm.sh/helm-${HELM_VERSION}-linux-${HELM_ARCH}.tar.gz" -o /tmp/helm.tgz; \
tar -C /tmp -xzf /tmp/helm.tgz; \
rm /tmp/helm.tgz; \
install -m 0755 "/tmp/linux-${HELM_ARCH}/helm" /usr/local/bin/helm; \
rm -rf "/tmp/linux-${HELM_ARCH}"; \
RG_VERSION="$(curl -fsSL -o /dev/null -w "%{url_effective}" https://github.com/BurntSushi/ripgrep/releases/latest | sed -n "s#.*/tag/##p")"; \
curl -fsSL "https://github.com/BurntSushi/ripgrep/releases/download/${RG_VERSION}/ripgrep-${RG_VERSION#v}-${RG_ARCH}.tar.gz" -o /tmp/rg.tgz; \
tar -C /tmp -xzf /tmp/rg.tgz; \
rm /tmp/rg.tgz; \
RG_DIR="/tmp/ripgrep-${RG_VERSION#v}-${RG_ARCH}"; \
install -m 0755 "${RG_DIR}/rg" /usr/local/bin/rg; \
rm -rf "${RG_DIR}" \
'
