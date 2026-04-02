"""Live model discovery from backend APIs using stored OAuth credentials.

Queries Claude (Anthropic), Codex (OpenAI), and Gemini (Google) APIs
to list available models. Uses the same auth dirs mounted into the
Docker container (~/.claude, ~/.codex, ~/.gemini).
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import httpx


async def discover_claude_models(claude_home: Path, default_model: str | None = None) -> dict:
    """Query Anthropic API for available Claude models."""
    try:
        creds_path = claude_home / ".credentials.json"
        if not creds_path.exists():
            return {"error": "no credentials file", "models": []}

        creds = json.loads(creds_path.read_text())
        token = creds.get("oauthAccessToken") or creds.get("access_token", "")
        if not token:
            return {"error": "no token in credentials", "models": []}

        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                "https://api.anthropic.com/v1/models",
                headers={
                    "x-api-key": token,
                    "anthropic-version": "2023-06-01",
                },
            )
            if resp.status_code == 200:
                data = resp.json()
                return {
                    "models": [m["id"] for m in data.get("data", [])],
                    "default": default_model,
                }
            return {"error": f"HTTP {resp.status_code}", "models": []}
    except Exception as e:
        return {"error": str(e), "models": []}


async def discover_codex_models(codex_home: Path, default_model: str | None = None) -> dict:
    """Query OpenAI API for available Codex/GPT models."""
    try:
        token = ""
        for auth_file in ["auth.json", ".credentials.json", "credentials.json"]:
            p = codex_home / auth_file
            if p.exists():
                data = json.loads(p.read_text())
                token = data.get("access_token") or data.get("token") or data.get("oauthAccessToken", "")
                if token:
                    break
        if not token:
            return {"error": "no OAuth token found", "models": []}

        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                "https://api.openai.com/v1/models",
                headers={"Authorization": f"Bearer {token}"},
            )
            if resp.status_code == 200:
                data = resp.json()
                return {
                    "models": sorted([m["id"] for m in data.get("data", [])]),
                    "default": default_model,
                }
            return {"error": f"HTTP {resp.status_code}", "models": []}
    except Exception as e:
        return {"error": str(e), "models": []}


async def discover_gemini_models(gemini_home: Path, default_model: str | None = None) -> dict:
    """Query Google Generative AI API for available Gemini models."""
    try:
        gemini_key = os.environ.get("GEMINI_API_KEY", "")
        if not gemini_key:
            for cfg_file in ["config.json", "credentials.json"]:
                p = gemini_home / cfg_file
                if p.exists():
                    data = json.loads(p.read_text())
                    gemini_key = data.get("api_key") or data.get("apiKey", "")
                    if gemini_key:
                        break
        if not gemini_key:
            return {"error": "no API key found", "models": []}

        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"https://generativelanguage.googleapis.com/v1beta/models?key={gemini_key}",
            )
            if resp.status_code == 200:
                data = resp.json()
                return {
                    "models": [m["name"].replace("models/", "") for m in data.get("models", [])],
                    "default": default_model,
                }
            return {"error": f"HTTP {resp.status_code}", "models": []}
    except Exception as e:
        return {"error": str(e), "models": []}


async def discover_all_models(
    backends: dict,
    claude_home: Path,
    codex_home: Path | None = None,
    gemini_home: Path | None = None,
) -> dict:
    """Query all backends for available models."""
    results = {}

    if "claude" in backends:
        results["claude"] = await discover_claude_models(
            claude_home, backends["claude"].get("default_model"),
        )

    if "codex" in backends and codex_home:
        results["codex"] = await discover_codex_models(
            codex_home, backends["codex"].get("default_model"),
        )

    if "gemini" in backends and gemini_home:
        results["gemini"] = await discover_gemini_models(
            gemini_home, backends["gemini"].get("default_model"),
        )

    return results
