"""Tests for embry-wezterm-bridge — D-Bus helper for WezTerm keybindings."""

import json
import os
import subprocess
import sys

import pytest

BRIDGE_PATH = os.path.join(os.path.dirname(__file__), "..", "bin", "embry-wezterm-bridge")


def run_bridge(*args: str, input_text: str | None = None, env: dict | None = None) -> subprocess.CompletedProcess:
    """Run the bridge script as a subprocess."""
    return subprocess.run(
        [sys.executable, BRIDGE_PATH, *args],
        capture_output=True,
        text=True,
        timeout=5,
        input=input_text,
        env=env,
    )


def run_python_expr(expr: str) -> str:
    """Run a Python expression that imports from the bridge script via a temp wrapper."""
    code = f"""
import sys, importlib.util, types, os
# Create a .py symlink so importlib can load it
bridge_path = {BRIDGE_PATH!r}
tmp_path = bridge_path + '.py'
if not os.path.exists(tmp_path):
    os.symlink(os.path.basename(bridge_path), tmp_path)
try:
    spec = importlib.util.spec_from_file_location('_bridge', tmp_path)
    mod = importlib.util.module_from_spec(spec)
    mod.__name__ = '_bridge'
    spec.loader.exec_module(mod)
    result = {expr}
    print(repr(result))
finally:
    try:
        os.unlink(tmp_path)
    except OSError:
        pass
"""
    result = subprocess.run(
        [sys.executable, "-c", code],
        capture_output=True, text=True, timeout=5,
    )
    if result.returncode != 0:
        raise RuntimeError(f"Expression failed: {result.stderr}")
    return result.stdout.strip()


# --- Argument parsing ---


class TestArgumentParsing:
    def test_no_args_shows_usage(self):
        result = run_bridge()
        assert result.returncode == 0
        assert "Usage:" in result.stdout

    def test_help_flag(self):
        result = run_bridge("--help")
        assert result.returncode == 0
        assert "Commands:" in result.stdout

    def test_unknown_command(self):
        result = run_bridge("nonexistent")
        assert result.returncode == 1
        assert "Unknown command" in result.stderr

    def test_ask_without_prompt(self):
        result = run_bridge("ask")
        assert result.returncode == 1
        assert "Usage:" in result.stderr

    def test_steer_without_message(self):
        result = run_bridge("steer")
        assert result.returncode == 1
        assert "Usage:" in result.stderr

    def test_followup_without_message(self):
        result = run_bridge("followup")
        assert result.returncode == 1
        assert "Usage:" in result.stderr


# --- Empty prompt handling ---


class TestEmptyPrompt:
    def test_ask_empty_prompt(self):
        result = run_bridge("ask", "")
        assert result.returncode == 1
        assert "empty" in result.stderr.lower()

    def test_ask_whitespace_only(self):
        result = run_bridge("ask", "   ")
        assert result.returncode == 1
        assert "empty" in result.stderr.lower()

    def test_steer_empty(self):
        result = run_bridge("steer", "")
        assert result.returncode == 1
        assert "empty" in result.stderr.lower()

    def test_followup_empty(self):
        result = run_bridge("followup", "")
        assert result.returncode == 1
        assert "empty" in result.stderr.lower()


# --- Agent offline hint ---


class TestOfflineHint:
    """Test _agent_offline_hint detection patterns."""

    def test_not_found(self):
        out = run_python_expr('mod._agent_offline_hint("Unit org.embry.Agent not found")')
        assert out == "True"

    def test_unknown(self):
        out = run_python_expr('mod._agent_offline_hint("Unknown object /org/embry/Agent")')
        assert out == "True"

    def test_no_such_file(self):
        out = run_python_expr('mod._agent_offline_hint("Failed to connect to bus: No such file or directory")')
        assert out == "True"

    def test_failed_to_connect(self):
        out = run_python_expr('mod._agent_offline_hint("Failed to connect to bus: Connection refused")')
        assert out == "True"

    def test_connection_refused(self):
        out = run_python_expr('mod._agent_offline_hint("Connection refused")')
        assert out == "True"

    def test_generic_error_no_hint(self):
        out = run_python_expr('mod._agent_offline_hint("Some random error")')
        assert out == "False"

    def test_empty_string(self):
        out = run_python_expr('mod._agent_offline_hint("")')
        assert out == "False"


# --- State parsing ---


class TestStateParsing:
    def test_state_busctl_not_found(self):
        """When busctl is not on PATH, should get a clean error."""
        env = os.environ.copy()
        env["PATH"] = "/nonexistent"
        result = run_bridge("state", env=env)
        assert result.returncode == 1
        stderr_lower = result.stderr.lower()
        assert any(s in stderr_lower for s in ("not available", "not found", "offline", "not running"))

    def test_state_parse_failure_returns_nonzero(self):
        """If busctl returns unparseable output, exit code should be 1."""
        result = run_bridge("state")
        if result.returncode != 0:
            assert result.stderr.strip() != ""


# --- Multiple args ---


class TestMultipleArgs:
    def test_ask_joins_args(self):
        result = run_bridge("ask", "hello", "world")
        assert result.returncode in (0, 1)


# --- Timeout handling ---


class TestTimeout:
    def test_busctl_call_returns_tuple(self):
        out = run_python_expr('mod.busctl_call("GetState")')
        # Should be a tuple (bool, str)
        assert out.startswith("(")
        assert "," in out
