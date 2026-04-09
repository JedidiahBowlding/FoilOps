#!/bin/bash

# Script to start both FailOps bot and Auto Solana Trading Bot
# Usage: ./start-both.sh

echo "🚀 Starting FailOps Wallet Tracker and Auto Solana Trading Bot..."

# Ensure required ports are free before launching services.
free_port() {
    local port="$1"
    local pid
    pid=$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | head -n 1)
    if [ -n "$pid" ]; then
        echo "⚠️  Port $port is already in use by PID $pid. Stopping it..."
        kill "$pid" 2>/dev/null || true
        sleep 1
    fi
}

free_port 8787
free_port 3001

# Function to handle cleanup on script exit
cleanup() {
    echo "🛑 Stopping all services..."
    # Kill all child processes
    pkill -P $$ 2>/dev/null || true
    exit
}

# Set up signal handlers for cleanup
trap cleanup SIGINT SIGTERM

# Start the Auto Solana Trading Bot in the background
echo "📈 Starting Auto Solana Trading Bot..."
cd Auto-solana-trading-bot
cargo run --bin trading-bot &
TRADING_PID=$!
cd ..

# Wait a moment for the trading bot to initialize
sleep 2

# Start the FailOps bot
echo "🤖 Starting FailOps Wallet Tracker..."
pnpm start &
FAILOPS_PID=$!

echo "✅ Both services started!"
echo "📈 Trading Bot PID: $TRADING_PID"
echo "🤖 FailOps Bot PID: $FAILOPS_PID"
echo ""
echo "Press Ctrl+C to stop both services"

# Wait for both processes
wait $TRADING_PID $FAILOPS_PID
