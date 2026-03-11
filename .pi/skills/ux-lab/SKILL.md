---
name: ux-lab
description: Multi-agent collaborative UX design canvas with real-time visual progress, course correction, and code export
triggers:
  - ux lab
  - create ux
  - design ux
  - design interface
  - collaborative design
  - multi-agent design
  - visual design canvas
  - design canvas
  - build ui
  - create interface
provides:
  - ux-lab
composes:
  - create-react-designs
  - review-design
  - test-interactions
  - create-design-board
  - agent-inbox
  - create-styleguide
  - task-monitor
allowed-tools: Bash, Read
metadata:
  short-description: Multi-agent collaborative design canvas with React export
  project-path: /home/graham/workspace/experiments/pi-mono
taxonomy:
  - design
  - frontend
  - precision
---

# ux-lab

Multi-agent collaborative UX design canvas with real-time visual progress,
course correction via agent-inbox chat well, and React/Tailwind code export.

## Architecture

- **Frontend**: React + Fabric.js infinite canvas (Vite, port 3000)
- **API Server**: Express on port 3001 (tsx watch)
- **WebSocket**: Real-time operation streaming for live agent progress
- **Dev runner**: `concurrently` launches both via `npm run dev`
- **State**: Zustand store with undo/redo history
- **Export**: React/Tailwind, SVG, and JSON export from canvas state
- **Theme**: NVIS MIL-STD-3009 dark theme

## Capabilities

- **Multi-agent collaborative canvas**: Multiple agents work simultaneously on
  different zones of the design, each with assigned colors and regions.
- **Agent registration and zone assignment**: Agents register via `agent-join`,
  get assigned zones, and submit operations via `agent-ops`.
- **Real-time operation streaming**: WebSocket pushes every operation to
  connected clients as it happens — live visual progress.
- **Course correction chat well**: The `/agent-inbox` composition lets humans
  send mid-design prompts to redirect agents without stopping.
- **Screenshot + review + test composition**: Capture canvas state, pipe through
  `/review-design` for critique and `/test-interactions` for usability checks.
- **`.ux.json` design document format**: Multi-page documents with full element
  state, agent metadata, and operation history.
- **Layered design prompting**: The `design` command decomposes a prompt into
  zones, assigns agents, and generates operations in three phases:
  skeleton, content, refine.
- **NVIS MIL-STD-3009 dark theme**: Military-standard dark UI for extended use.
- **React/Tailwind, SVG, JSON export**: Export designs as production-ready
  React components, SVG graphics, or raw JSON state.

## Commands

| Command      | Description                                      |
|-------------|--------------------------------------------------|
| `start`     | Launch dev server in background, wait for health |
| `stop`      | Kill background dev server                       |
| `status`    | Health check the running server                  |
| `create`    | Add element (rect, text, circle, button, etc.)   |
| `select`    | Get current canvas selection                     |
| `update`    | Patch element properties by ID                   |
| `delete`    | Remove element by ID                             |
| `list`      | List all elements on canvas                      |
| `export`    | Export canvas as React/Tailwind, SVG, or JSON    |
| `undo`      | Undo last action                                 |
| `redo`      | Redo last undone action                          |
| `save`      | Save canvas state as JSON to stdout              |
| `load`      | Load canvas state from stdin or --file           |
| `agent-join`| Register an agent with name and color            |
| `agent-ops` | Submit operations for a registered agent         |
| `prompt`    | Send course correction message to agents         |
| `watch`     | Poll ops log in real time (Ctrl+C to stop)       |
| `agents`    | List registered agents                           |
| `ops-log`   | Get operation log (--last N)                     |
| `screenshot`| Capture canvas as PNG                            |
| `review`    | Trigger /review-design on current canvas         |
| `test`      | Trigger /test-interactions on current canvas     |
| `load-brief`| Load a DESIGN_BOARD.md file                      |
| `save-doc`  | Save full .ux.json document (--name, --output)   |
| `load-doc`  | Load .ux.json document (--file)                  |
| `pages`     | List pages in current document                   |
| `add-page`  | Add page to document (--name)                    |
| `design`    | Decompose prompt into zones and generate plan    |
| `help`      | Show usage                                       |

## Usage

```bash
# Start the canvas server
./run.sh start

# Create elements
./run.sh create --type rect --x 100 --y 100 --fill "#3b82f6"
./run.sh create --type text --x 200 --y 50 --text "Hello World"
./run.sh create --type button --x 100 --y 300 --text "Click Me" --variant primary

# Manipulate elements
./run.sh list
./run.sh update <element-id> --fill "#ef4444" --x 200
./run.sh delete <element-id>

# Design orchestration — decompose prompt into agent assignments
./run.sh design "dashboard with navbar and sidebar"

# Multi-agent collaboration
./run.sh agent-join '{"name":"layout-agent","color":"#3b82f6"}'
./run.sh agent-ops <agent-id> '{"ops":[...]}'
./run.sh prompt "make the sidebar wider" --agent layout-agent
./run.sh watch

# Export to React
./run.sh export --format react

# Document management
./run.sh save-doc --name "my-design" --output design.ux.json
./run.sh load-doc --file design.ux.json
./run.sh pages
./run.sh add-page --name "Settings"

# Undo/redo
./run.sh undo
./run.sh redo

# Save and load state
./run.sh save > my-design.json
./run.sh load --file my-design.json

# Stop server
./run.sh stop
```

## Agent Workflow

Agents compose this skill to build UI designs collaboratively:

1. `./run.sh start` — launch canvas
2. `./run.sh design "dashboard with navbar and sidebar"` — decompose into zones
3. Multiple agents register via `agent-join` and work their assigned zones
4. `./run.sh watch` — stream live progress via WebSocket
5. `./run.sh prompt "adjust the sidebar"` — course correct mid-design
6. `./run.sh screenshot` — capture for `/review-design` critique
7. `./run.sh test` — run `/test-interactions` usability checks
8. `./run.sh export --format react` — generate React/Tailwind component
9. Hand off to `/create-react-designs` or `/create-styleguide` for refinement
10. `./run.sh stop` — clean up

## API Base

All REST endpoints live at `http://localhost:3001/api/`.
