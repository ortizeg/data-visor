#!/usr/bin/env bash
# scripts/vm-startup.sh -- GCP VM startup script
# This runs automatically on first boot via instance metadata
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

# Install Docker and Docker Compose plugin
apt-get update
apt-get install -y docker.io docker-compose-plugin git

# Enable Docker to start on boot
systemctl enable docker
systemctl start docker

# Clone repository
cd /opt
if [ ! -d data-visor ]; then
    git clone https://github.com/YOUR_USER/data-visor.git
fi
cd data-visor

# Create data directory
mkdir -p data

# NOTE: .env must be created manually (contains secrets)
# The deploy-gcp.sh script prints instructions for this step
echo "DataVisor VM setup complete. Create .env and run: docker compose up -d --build"
