FROM node:22-slim

# Install Python + pip + bubblewrap (Codex sandbox) + git
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv python3-dev build-essential curl \
    bubblewrap git \
    && rm -rf /var/lib/apt/lists/*

# Install all three agent CLIs globally
RUN npm install -g \
    @anthropic-ai/claude-code@latest \
    @openai/codex@latest \
    @google/gemini-cli@0.33.1

# Use the existing 'node' user (UID 1000)
# Pre-create auth dirs and placeholder files
RUN mkdir -p /home/node/.claude /home/node/.codex /home/node/.gemini \
    && touch /home/node/.claude/.credentials.json \
    && touch /home/node/.claude/settings.json \
    && chown -R node:node /home/node/.claude /home/node/.codex /home/node/.gemini
USER node
WORKDIR /home/node

# Install Python deps in user space
COPY --chown=node:node requirements.txt .
# Install torch with CUDA 12.8 matching host driver (pinned for reproducibility)
RUN python3 -m pip install --user --break-system-packages \
    torch==2.7.1+cu128 torchvision==0.22.1+cu128 --extra-index-url https://download.pytorch.org/whl/cu128
# Install remaining deps
RUN python3 -m pip install --user --break-system-packages -r requirements.txt

# Copy server + local Python modules it imports
COPY --chown=node:node \
    server.py \
    backends.yml \
    task_tracking.py \
    parse_output.py \
    image_io.py \
    model_discovery.py \
    ./

# Ensure user-installed Python packages are on PATH
ENV PATH="/home/node/.local/bin:${PATH}"

EXPOSE 8620

ENV SUBAGENT_PORT=8620

# Strip host hooks + set permissions + fix stale Codex skills symlink
CMD rm -f /home/node/.codex/skills 2>/dev/null; mkdir -p /home/node/.codex/skills 2>/dev/null; \
    python3 -c "import json,pathlib; p=pathlib.Path('/home/node/.claude/settings.json'); d=json.loads(p.read_text()) if p.exists() else {}; d['hooks']={}; d['permissions']={'allow':['Bash(*)', 'Read(*)', 'Write(*)', 'Edit(*)', 'Glob(*)', 'Grep(*)']}; p.write_text(json.dumps(d))" 2>/dev/null; \
    python3 -m uvicorn server:app --host 0.0.0.0 --port ${SUBAGENT_PORT} --http h11 --h11-max-incomplete-event-size 52428800
