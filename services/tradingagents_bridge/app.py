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
from tradingagents.llm_clients.factory import create_llm_client

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
            if path == "/v1/analyze/contract":
                evidence = payload.get("evidence")
                chain = str(payload.get("chain", "")).strip().lower()
                address = str(payload.get("address", "")).strip()
                if not isinstance(evidence, dict) or not chain or not address:
                    return self.reply(400, {"message": "chain, address and evidence are required"})
                # Evidence is supplied by FoilOps; agents must not invent or execute transactions.
                compact = json.dumps(evidence, separators=(",", ":"))[:700_000]
                config = graph_config()
                llm = create_llm_client(config["llm_provider"], config["deep_think_llm"], config.get("backend_url")).get_llm()
                roles = {
                    "contractSecurity": "Audit contract controls, upgradeability, taxes, transfer restrictions and technical failure modes.",
                    "marketLiquidity": "Audit pools, usable liquidity, volume, concentration, price impact and manipulation risk.",
                    "provenance": "Audit deployer provenance, linked websites/social claims, DAO, protocol and NFT evidence.",
                    "skeptic": "Argue the strongest evidence-based case against trusting this token. Identify unknowns explicitly.",
                }
                reports = {}
                with GRAPH_LOCK:
                    for key, duty in roles.items():
                        response = llm.invoke(f"You are a {key} analyst. {duty} Use only supplied evidence; label facts, claims, conflicts and unknowns. Never recommend or execute a trade. Chain={chain}; exact address={address}; evidence={compact}")
                        reports[key] = str(response.content)
                    synthesis = llm.invoke("Act as an independent risk manager. Synthesize these reports into a human-readable dossier with verdict RESEARCH, WATCHLIST, HIGH_RISK, or REJECT; cite evidence fields and never recommend a trade. " + json.dumps(reports))
                return self.reply(200, {"mode": "contract", "chain": chain, "address": address, "reports": reports, "decision": str(synthesis.content)})
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
