# Security

Harbor is a private, single-owner Docker workspace. It is not a multi-tenant access-control system.

## Deployment boundary

- Keep the shell and every app gateway on a trusted private network. Harbor has no built-in authentication or per-app authorization. Anyone allowed to reach its listener ports can access inventory and discovered apps, subject to each app's own sign-in.
- The default published bind address is loopback. Use a private/Tailscale address deliberately and restrict all published ports with your network policy. Do not use a public bind or tunnel without adding and validating access controls across **all** gateway ports.
- Treat containers sharing gateway networks as trusted. Joining app networks makes Harbor reachable from those networks too. The host helper supports an explicit network allowlist.
- Only the internal inspector mounts the Docker socket. It permits GET inventory, host information and one-shot resource samples; it rejects other methods and paths. The read-only socket mount alone does not make the Docker API read-only. A compromised inspector process still holds a powerful socket, so keep Docker and dependencies maintained.

## Gateway behavior

Harbor changes `X-Frame-Options` and the `frame-ancestors` CSP directive to permit embedding by its shell. It retains other enforced CSP directives. It translates source origins and same-upstream redirects, namespaces cookies, and proxies HTTP/WebSockets to discovered endpoints.

Separate ports provide distinct web origins. Cookie namespaces prevent accidental session collisions; they do not create confidentiality between mutually untrusted apps because cookies are shared across ports on a hostname. Do not use Harbor to isolate hostile applications.

Internal upstream TLS verification is disabled to support local self-signed services. Use trusted Docker networks. Public-facing certificates must be valid for the configured hostname. External sign-in can be configured as an ordinary HTTPS browser link rather than an embedded gateway.

Discovery probes exposed TCP ports with GET requests, excluding common non-HTTP ports. Do not expose destructive unauthenticated GET handlers. Inventory includes container names, images, network names, port bindings and Compose working directories; environment variables and raw inspect output are not exposed.

## Private files

Never commit `.env`, certificate keys, `data/`, real inventory exports, authenticated browser profiles, or screenshots containing private app data. Per-deployment `config/projects.json` is also ignored. The committed example and screenshots use fictional data.

## Reporting a vulnerability

Use [GitHub's private vulnerability reporting](https://github.com/newtonlorenz/docker-harbor/security/advisories/new). Do not include secrets in public issues. Include the affected commit, reproduction steps and expected versus actual behavior. The initial release is maintained on `main`; there is no separate long-term-support branch or response-time guarantee.
