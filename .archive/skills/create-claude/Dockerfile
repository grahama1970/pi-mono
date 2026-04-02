FROM node:22-slim

# Install Python + pip for FastAPI server
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv curl \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI globally
RUN npm install -g @anthropic-ai/claude-code@latest

# Use the existing 'node' user (UID 1000) — matches typical host UID
# and avoids UID collision in the node base image
# Pre-create .claude dir and placeholder files owned by node.
# Docker bind-mounts require target files to exist as files (not dirs)
# otherwise it creates directories as mount points.
RUN mkdir -p /home/node/.claude \
    && touch /home/node/.claude/.credentials.json \
    && touch /home/node/.claude/settings.json \
    && chown -R node:node /home/node/.claude
USER node
WORKDIR /home/node

# Install Python deps in user space
COPY --chown=node:node requirements.txt .
RUN python3 -m pip install --user --break-system-packages -r requirements.txt

# Copy server
COPY --chown=node:node server.py .

# Ensure user-installed Python packages are on PATH
ENV PATH="/home/node/.local/bin:${PATH}"

EXPOSE 8620

CMD ["python3", "-m", "uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8620"]
