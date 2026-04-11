#!/usr/bin/env python3
"""YouTube Monitoring Service for knowledge corpus.

Monitors channels, ingests transcripts, and distills them into QRA pairs in memory.
"""
from __future__ import annotations

import os
import json
import subprocess
import argparse
from pathlib import Path
from datetime import datetime

# Configuration
CHANNELS = {
    "trelisresearch": "https://www.youtube.com/@TrelisResearch",
    "code4ai": "https://www.youtube.com/@code4AI",
    "aivideoschool": "https://www.youtube.com/@aivideoschool",
    "nobodyandthecomputer": "https://www.youtube.com/@nobodyandthecomputer",
}

BASE_DIR = Path("/home/graham/workspace/experiments/pi-mono")
RUN_DIR = BASE_DIR / "run" / "youtube-transcripts"
MD_DIR = BASE_DIR / ".pi/skills/create-music/docs/research/youtube_transcripts"
KNOWLEDGE_SCOPE = "research"
KNOWLEDGE_CONTEXT = "AI Music Documentary Researcher"

def run_cmd(cmd: str, cwd: Optional[Path] = None, env: Optional[dict] = None) -> subprocess.CompletedProcess:
    """Run a shell command and return result."""
    current_env = os.environ.copy()
    if env:
        current_env.update(env)
    
    print(f"Running: {cmd}")
    return subprocess.run(
        cmd, 
        shell=True, 
        capture_output=True, 
        text=True, 
        cwd=str(cwd) if cwd else None,
        env=current_env
    )

def monitor_channels(max_new: int = 5):
    """Monitor channels and process new videos."""
    MD_DIR.mkdir(parents=True, exist_ok=True)
    
    for name, url in CHANNELS.items():
        print(f"\n--- Checking channel: {name} ({url}) ---")
        channel_run_dir = RUN_DIR / name
        channel_json_dir = channel_run_dir / "json"
        channel_json_dir.mkdir(parents=True, exist_ok=True)
        
        # 1. Get latest video IDs from YouTube
        res = run_cmd(f"yt-dlp --flat-playlist --print id {url}/videos | head -n {max_new}")
        if res.returncode != 0:
            print(f"Error fetching IDs for {name}: {res.stderr}")
            continue
            
        video_ids = [vid.strip() for vid in res.stdout.strip().split("\n") if vid.strip()]
        
        # 2. Filter for videos we haven't processed yet
        new_ids = []
        for vid in video_ids:
            if not (channel_json_dir / f"{vid}.json").exists():
                new_ids.append(vid)
        
        if not new_ids:
            print(f"No new videos found for {name}.")
            continue
            
        print(f"Found {len(new_ids)} new videos for {name}: {new_ids}")
        
        # 3. Create a batch file for ingest-youtube
        batch_file = channel_run_dir / "pending_videos.txt"
        batch_file.write_text("\n".join(new_ids))
        
        # 4. Ingest transcripts (Download JSON)
        # We use the 'batch' command of ingest-youtube
        ingest_cmd = f"./run.sh batch --input {batch_file} --output {channel_json_dir} --no-whisper"
        res = run_cmd(ingest_cmd, cwd=BASE_DIR / ".pi/skills/ingest-youtube")
        print(res.stdout)
        
        # 5. Sync to registry
        sync_cmd = f"./run.sh sync --ingest-root {RUN_DIR}"
        run_cmd(sync_cmd, cwd=BASE_DIR / ".pi/skills/consume-youtube")
        
        # 6. Extract to Markdown (into channel-specific subdirs)
        channel_md_dir = MD_DIR / name
        channel_md_dir.mkdir(parents=True, exist_ok=True)
        extract_cmd = f"./run.sh extract --channel {name} --output-dir {channel_md_dir}"
        run_cmd(extract_cmd, cwd=BASE_DIR / ".pi/skills/consume-youtube")

        # 7. Distill new MD files to QRA with Federated Taxonomy enrichment
        # We use the improved doc2qra with --directory and --collection flags
        # scillm proxy handles model routing - just use model="text"
        distill_cmd = f"./run.sh --directory {channel_md_dir} --scope {KNOWLEDGE_SCOPE} --context '{KNOWLEDGE_CONTEXT}' --tags 'youtube,{name}' --collection operational"
        res = run_cmd(distill_cmd, cwd=BASE_DIR / ".pi/skills/doc2qra")
        print(res.stdout)
        if res.stderr:
            print(f"Distill errors: {res.stderr}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Monitor YouTube channels for new knowledge.")
    parser.add_argument("--max-new", type=int, default=5, help="Max new videos per channel to check")
    args = parser.parse_args()
    
    monitor_channels(max_new=args.max_new)
