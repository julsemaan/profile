# code-sandbox-img

A development **base image** intended for installing coding agents and sandboxed developer tools on top of it.

## What this image includes

This image starts from `node:25-bookworm` and installs common tooling used by coding-agent workflows:

- Node.js (from base image)
- `curl`, `ca-certificates`, `clang-format`
- Go (latest stable at build time)
- `kubectl` (latest stable at build time)
- Helm (latest stable at build time)
- `rg` / ripgrep (latest release at build time)

## Publishing

GitHub Actions builds the image for pull requests and publishes `julsemaan/code-sandbox-img` on pushes to the default branch or version tags.

Required repository secrets:

- `DOCKERHUB_USERNAME`
- `DOCKERHUB_TOKEN`

## Example usage

Use this image as the base in your own Dockerfile, then install the coding agent you want to run:

```Dockerfile
FROM julsemaan/code-sandbox-img:latest

RUN npm i -g @openai/codex

ENTRYPOINT ["codex", "--dangerously-bypass-approvals-and-sandbox"]
```

Reference implementations:

- [`codex-unleashed-safely.sh`](https://github.com/julsemaan/profile/blob/master/profile/codex-unleashed-safely.sh)
- [`pi-unleashed-safely.sh`](https://github.com/julsemaan/profile/blob/master/profile/pi-unleashed-safely.sh)
- [`opencode-unleashed-safely.sh`](https://github.com/julsemaan/profile/blob/master/profile/opencode-unleashed-safely.sh)
