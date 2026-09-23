@echo off
rem Shim that mimics how `npx`/`uvx` are distributed on Windows: a .cmd wrapper
rem around `node`. The bridge must be able to spawn this to prove it can launch
rem npx/uvx-style servers at all.
node "%~dp0mcp-test-server.mjs" %*
