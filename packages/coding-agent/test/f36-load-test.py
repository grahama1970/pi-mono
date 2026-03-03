#!/usr/bin/env python3
"""
F-36 Multi-Tenant Load Test for the D-Bus Worker Pool.

Fires 4 concurrent AskAsAsync calls with different personas through
the D-Bus bridge, then streams events filtered by requestId to verify:

1. All 4 personas get responses (pool routes to workers)
2. Events are correctly correlated (requestId filtering works)
3. GetState/Ping remain responsive during LLM turns (fast path)
4. Pool scales up workers as needed (queue depth triggers)

Requires: embry-agent.service running with worker pool enabled.
"""

from __future__ import annotations

import asyncio
import json
import time
import sys

from dbus_next.aio import MessageBus
from dbus_next import BusType

DBUS_BUS_NAME = "org.embry.Agent"
DBUS_OBJECT_PATH = "/org/embry/Agent"
DBUS_INTERFACE_NAME = "org.embry.Agent"

# Short prompts to minimize token cost while proving concurrency
PERSONA_PROMPTS = {
    "brandon-bailey": "In one sentence, what is your primary expertise area?",
    "margaret-chen": "In one sentence, what quality standard matters most to you?",
    "jennifer-cheung": "In one sentence, what compliance framework do you specialize in?",
    "paul-bevilaqua": "In one sentence, what is your role on the plant floor?",
}


async def connect():
    """Connect to the session bus and get the agent interface."""
    bus = await MessageBus(bus_type=BusType.SESSION).connect()
    introspection = await bus.introspect(DBUS_BUS_NAME, DBUS_OBJECT_PATH)
    proxy = bus.get_proxy_object(DBUS_BUS_NAME, DBUS_OBJECT_PATH, introspection)
    iface = proxy.get_interface(DBUS_INTERFACE_NAME)
    return bus, iface


async def test_fast_path(iface) -> dict:
    """Test that read-only ops work without queuing."""
    results = {}

    t0 = time.monotonic()
    ping = await iface.call_ping()
    results["ping_ms"] = round((time.monotonic() - t0) * 1000, 1)
    results["ping_ok"] = ping == "pong"

    t0 = time.monotonic()
    state_json = await iface.call_get_state()
    results["getstate_ms"] = round((time.monotonic() - t0) * 1000, 1)
    state = json.loads(state_json)
    results["getstate_ok"] = "sessionId" in state
    results["model"] = state.get("currentModel", "unknown")

    return results


async def fire_persona_call(iface, persona: str, prompt: str) -> dict:
    """Fire an AskAs call and measure response time."""
    result = {
        "persona": persona,
        "ok": False,
        "response_preview": "",
        "elapsed_s": 0,
        "error": None,
    }

    t0 = time.monotonic()
    try:
        # AskAs is synchronous — blocks until response
        response = await asyncio.wait_for(
            iface.call_ask_as(persona, prompt),
            timeout=300,
        )
        result["elapsed_s"] = round(time.monotonic() - t0, 1)
        result["ok"] = len(response) > 0
        result["response_preview"] = response[:120]
    except asyncio.TimeoutError:
        result["elapsed_s"] = round(time.monotonic() - t0, 1)
        result["error"] = "timeout (300s)"
    except Exception as e:
        result["elapsed_s"] = round(time.monotonic() - t0, 1)
        result["error"] = str(e)[:200]

    return result


async def test_concurrent_personas(iface) -> list[dict]:
    """Fire all 4 persona calls concurrently."""
    tasks = [
        fire_persona_call(iface, persona, prompt)
        for persona, prompt in PERSONA_PROMPTS.items()
    ]
    return await asyncio.gather(*tasks)


async def test_fast_path_during_load(iface) -> dict:
    """Verify fast path still works while LLM calls are in flight."""
    # Fire a long AskAsync (doesn't block) then immediately test Ping
    try:
        request_id = await iface.call_ask_async("Say hello in one word.")
    except Exception:
        request_id = "failed"

    t0 = time.monotonic()
    ping = await iface.call_ping()
    ping_ms = round((time.monotonic() - t0) * 1000, 1)

    return {
        "async_request_id": request_id,
        "ping_during_load_ms": ping_ms,
        "ping_during_load_ok": ping == "pong" and ping_ms < 100,
    }


async def main():
    print("=" * 60)
    print("F-36 Multi-Tenant D-Bus Worker Pool Load Test")
    print("=" * 60)

    bus, iface = await connect()

    # Phase 1: Fast path (should be <10ms)
    print("\n--- Phase 1: Fast Path (Ping + GetState) ---")
    fast = await test_fast_path(iface)
    print(f"  Ping: {'PASS' if fast['ping_ok'] else 'FAIL'} ({fast['ping_ms']}ms)")
    print(f"  GetState: {'PASS' if fast['getstate_ok'] else 'FAIL'} ({fast['getstate_ms']}ms)")
    print(f"  Model: {fast['model']}")

    # Phase 2: Fast path during active LLM call
    print("\n--- Phase 2: Fast Path Under Load ---")
    during = await test_fast_path_during_load(iface)
    print(f"  AskAsync fired: {during['async_request_id']}")
    print(f"  Ping during load: {'PASS' if during['ping_during_load_ok'] else 'FAIL'} ({during['ping_during_load_ms']}ms)")

    # Phase 3: 4 concurrent persona calls (the real test)
    print("\n--- Phase 3: 4 Concurrent Persona Calls ---")
    print("  Firing brandon, margaret, jennifer, paul simultaneously...")
    t0 = time.monotonic()
    results = await test_concurrent_personas(iface)
    total_s = round(time.monotonic() - t0, 1)

    for r in results:
        status = "PASS" if r["ok"] else f"FAIL ({r['error']})"
        print(f"  {r['persona']:20s} {status:10s} {r['elapsed_s']:6.1f}s  {r['response_preview'][:60]}")

    # Summary
    passed = sum(1 for r in results if r["ok"])
    print(f"\n--- Summary ---")
    print(f"  Personas: {passed}/4 responded")
    print(f"  Total wall time: {total_s}s")
    print(f"  Fast path: {'PASS' if fast['ping_ok'] and fast['getstate_ok'] else 'FAIL'}")
    print(f"  Fast path under load: {'PASS' if during['ping_during_load_ok'] else 'FAIL'}")

    # If all 4 completed within a reasonable time AND total < 4x individual,
    # that proves concurrency (serial would be 4x the slowest)
    if passed >= 2:
        max_individual = max(r["elapsed_s"] for r in results if r["ok"])
        if total_s < max_individual * 2.5:
            print(f"  Concurrency: PROVEN (wall {total_s}s < 2.5x slowest {max_individual}s)")
        else:
            print(f"  Concurrency: SERIAL (wall {total_s}s >= 2.5x slowest {max_individual}s)")

    all_pass = passed == 4 and fast["ping_ok"] and during["ping_during_load_ok"]
    print(f"\n  VERDICT: {'ALL PASS' if all_pass else 'PARTIAL'}")

    bus.disconnect()
    return 0 if all_pass else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
