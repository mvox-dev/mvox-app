# Feedback MCP sidecar: sshd starts the read-only server per connection, one forced command per key.
# Build context is this directory: docker build -t mvox-feedback-mcp services/feedback-mcp
FROM node:22-slim

RUN apt-get update \
	&& apt-get install -y --no-install-recommends openssh-server \
	&& rm -rf /var/lib/apt/lists/* \
	&& rm -f /etc/ssh/ssh_host_* \
	&& mkdir -p /run/sshd /etc/feedback-mcp/host-keys /var/log/feedback-mcp

WORKDIR /opt/feedback-mcp
COPY package.json tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN corepack enable \
	&& pnpm install --no-frozen-lockfile \
	&& pnpm build \
	&& pnpm prune --prod \
	&& chmod 755 dist/main.js \
	&& ln -s /opt/feedback-mcp/dist/main.js /usr/local/bin/feedback-mcp

# No password ('*' is not a locked account to sshd, so key logins work) and no docker group.
RUN useradd --uid 10010 --create-home --shell /bin/sh feedback \
	&& usermod -p '*' feedback \
	&& chown feedback /var/log/feedback-mcp

COPY sshd_config /etc/ssh/sshd_config

EXPOSE 2223
CMD ["/usr/sbin/sshd", "-D", "-e", "-f", "/etc/ssh/sshd_config"]
