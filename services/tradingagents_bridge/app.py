"""Private FoilOps bridge for the upstream TradingAgents package.

Bind this service to loopback only. It deliberately has no wallet or signing API.
"""
from __future__ import annotations

import json
import os
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Lock
from urllib.parse import urlparse

from tradingagents.default_config import DEFAULT_CONFIG
from tradingagents.graph.trading_graph import TradingAgentsGraph

HOST = os.getenv("TRADINGAGENTS_BRIDGE_HOST", "127.0.0.1")
PORT = int(os.getenv("TRADINGAGENTS_BRIDGE_PORT", "8790"))
TOKEN = os.environ.get("TRADINGAGENTS_BRIDGE_TOKEN", "")
MAX_BODY = 1_000_000
GRAPH_LOCK = Lock()


def graph_config() -> dict:
    config = DEFAULT_CONFIG.copy()
    config["selected_analysts"] = ["market", "social", "news", "fundamentals"]
    return config


class Handler(BaseHTTPRequestHandler):
    server_version = "FoilOpsTradingAgents/1"

    def log_message(self, fmt: str, *args: object) -> None:
        # Never log request bodies or authorization values.
        print("tradingagents-bridge", self.address_string(), fmt % args)

    def reply(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, default=str).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.send_header("cache-control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def authorized(self) -> bool:
        return bool(TOKEN) and self.headers.get("authorization") == f"Bearer {TOKEN}"

    def do_GET(self) -> None:
        if urlparse(self.path).path != "/health":
            return self.reply(404, {"message": "not found"})
        self.reply(200, {"ok": True, "service": "tradingagents", "configured": bool(TOKEN)})

    def do_POST(self) -> None:
        if not self.authorized():
            return self.reply(401, {"message": "unauthorized"})
        length = int(self.headers.get("content-length", "0"))
        if length < 1 or length > MAX_BODY:
            return self.reply(413, {"message": "invalid request size"})
        try:
            payload = json.loads(self.rfile.read(length))
            path = urlparse(self.path).path
            if path != "/v1/analyze/ticker":
                return self.reply(404, {"message": "not found"})
            ticker = str(payload.get("ticker", "")).strip().upper()
            analysis_date = str(payload.get("date") or date.today().isoformat())
            if not ticker or len(ticker) > 32 or any(c not in "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-^=" for c in ticker):
                return self.reply(400, {"message": "invalid ticker"})
            with GRAPH_LOCK:
                state, decision = TradingAgentsGraph(debug=False, config=graph_config()).propagate(ticker, analysis_date)
            self.reply(200, {
                "mode": "ticker", "ticker": ticker, "analysisDate": analysis_date,
                "decision": decision, "reports": {
                    key: state.get(key) for key in (
                        "market_report", "sentiment_report", "news_report",
                        "fundamentals_report", "investment_debate_state",
                        "risk_debate_state", "trader_investment_plan"
                    ) if state.get(key) is not None
                }
            })
        except Exception as exc:
            self.reply(500, {"message": f"analysis failed: {type(exc).__name__}"})


if __name__ == "__main__":
    if not TOKEN:
        raise SystemExit("TRADINGAGENTS_BRIDGE_TOKEN is required")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()

