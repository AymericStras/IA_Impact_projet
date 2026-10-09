#!/usr/bin/env python3
"""Small local API launchers. Credentials stay in macOS Keychain."""

import argparse
import getpass
import json
import os
from pathlib import Path
import subprocess
import sys
import urllib.error
import urllib.request

SERVICES = {
    "gpt": ("sncf-openai-api-key", "OPENAI_API_KEY"),
    "stitch": ("medici-stitch-api-key", "STITCH_API_KEY"),
}


def secret(provider):
    service, _ = SERVICES[provider]
    result = subprocess.run(
        ["/usr/bin/security", "find-generic-password", "-a", getpass.getuser(),
         "-s", service, "-w"],
        capture_output=True, text=True, timeout=15, check=False,
    )
    if result.returncode or not result.stdout.strip():
        raise ValueError(f"Cannot read macOS Keychain service: {service}")
    return result.stdout.strip()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("API redirect refused; credentials were not forwarded.")


def request(provider, path="", payload=None, timeout=30):
    key = secret(provider)
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    if provider == "gpt":
        url = "https://api.openai.com/v1/" + path
        headers["Authorization"] = "Bearer " + key
    else:
        url = "https://stitch.googleapis.com/mcp"
        headers["X-Goog-Api-Key"] = key
    data = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, headers=headers)
    try:
        with urllib.request.build_opener(NoRedirect).open(req, timeout=timeout) as response:
            raw = response.read(8 * 1024 * 1024 + 1)
        if len(raw) > 8 * 1024 * 1024:
            raise ValueError("Response exceeds the 8 MiB CLI limit.")
        result = json.loads(raw.decode().replace(key, "<REDACTED>"))
    except urllib.error.HTTPError as exc:
        raise ValueError(f"{provider}: HTTP {exc.code}; check access, quota and request parameters.") from None
    except urllib.error.URLError:
        raise ValueError(f"{provider}: network/TLS request failed.") from None
    if not isinstance(result, dict):
        raise ValueError("Expected a JSON object from the API.")
    return result


def json_argument(value):
    if value.startswith("@"):
        value = Path(value[1:]).read_text()
    elif value == "-":
        value = sys.stdin.read()
    result = json.loads(value)
    if not isinstance(result, dict):
        raise ValueError("The JSON payload must be an object.")
    return result


def output(value):
    print(json.dumps(value, ensure_ascii=False, indent=2))


def main():
    name = Path(sys.argv[0]).name
    parser = argparse.ArgumentParser(prog=name)
    if name == "with-api-env":
        parser.description = "Inject Keychain credentials into one child process; never print them."
        parser.add_argument("provider", choices=["gpt", "stitch", "all"])
        parser.add_argument("command", nargs=argparse.REMAINDER)
        args = parser.parse_args()
        command = args.command
        if command[:1] == ["--"]:
            command = command[1:]
        if not command:
            parser.error("provide a command after --")
        env = os.environ.copy()
        providers = SERVICES if args.provider == "all" else [args.provider]
        for provider in providers:
            env[SERVICES[provider][1]] = secret(provider)
        os.execvpe(command[0], command, env)

    if name not in SERVICES:
        parser.error("use tools/gpt, tools/stitch or tools/with-api-env")
    sub = parser.add_subparsers(dest="action", required=True)
    sub.add_parser("status", help="check local credential availability without a network request")
    if name == "gpt":
        sub.add_parser("check", help="verify credentials with GET /v1/models")
        sub.add_parser("models", help="list accessible model IDs")
        call = sub.add_parser("request", help="POST a JSON object to /v1/responses")
        call.add_argument("payload", help="JSON, @path/to/request.json, or - for stdin")
    else:
        sub.add_parser("tools", help="list live Stitch tool names and schemas")
        call = sub.add_parser("call", help="call a Stitch tool")
        call.add_argument("tool")
        call.add_argument("arguments", nargs="?", default="{}", help="JSON, @file, or -")
    args = parser.parse_args()
    if args.action == "status":
        secret(name)
        output({"provider": name, "credential": "available", "keychain_service": SERVICES[name][0]})
        return
    if name == "gpt":
        if args.action in ("models", "check"):
            result = request(name, "models")
            models = sorted(model["id"] for model in result.get("data", []))
            output({"authenticated": True, "model_count": len(models)} if args.action == "check" else models)
        else:
            payload = json_argument(args.payload)
            if not payload.get("model"):
                raise ValueError("Specify model in the JSON request; no model is selected automatically.")
            output(request(name, "responses", payload, timeout=180))
    else:
        payload = {"jsonrpc": "2.0", "id": 1, "method": "tools/list"}
        if args.action == "call":
            payload.update(method="tools/call", params={"name": args.tool, "arguments": json_argument(args.arguments)})
        result = request(name, payload=payload, timeout=300 if args.action == "call" else 30)
        output(result)
        if "error" in result or result.get("result", {}).get("isError"):
            raise SystemExit(1)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        sys.exit(130)
