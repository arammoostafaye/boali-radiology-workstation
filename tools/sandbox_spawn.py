#!/usr/bin/env python3
"""Sandbox-safe detached spawner (double-fork).

The cloud sandbox reaps process trees when each bash tool command ends;
a double-fork reparents the service to init within milliseconds so it
survives across commands (same trick the surviving medal mock server
and boali-pacs service effectively rely on).

Usage:
    python3 tools/sandbox_spawn.py <cwd> <logfile> <cmd> [args...]
"""
import os
import sys

cwd, logfile, cmd = sys.argv[1], sys.argv[2], sys.argv[3:]
pid = os.fork()
if pid == 0:
    os.setsid()
    if os.fork() == 0:
        os.chdir(cwd)
        env = os.environ.copy()
        env.setdefault("OMP_NUM_THREADS", "2")
        env.setdefault("MKL_NUM_THREADS", "2")
        with open(logfile, "ab", buffering=0) as fh:
            fh.write(f"\n===== spawn {cmd} at {os.times().elapsed if hasattr(os.times(), 'elapsed') else ''} =====\n".encode())
            os.dup2(fh.fileno(), 1)
            os.dup2(fh.fileno(), 2)
            os.execvpe(cmd[0], cmd, env)
        os._exit(1)
    os._exit(0)
_, status = os.waitpid(pid, 0)
sys.exit(os.waitstatus_to_exitcode(status) if hasattr(os, "waitstatus_to_exitcode") else 0)
