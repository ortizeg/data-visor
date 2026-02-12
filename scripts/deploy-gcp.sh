#!/usr/bin/env bash
# scripts/deploy-gcp.sh -- Provision a GCP VM for DataVisor
set -euo pipefail

# Required environment variables
PROJECT_ID="${GCP_PROJECT_ID:?Set GCP_PROJECT_ID environment variable}"

# Configurable with defaults
ZONE="${GCP_ZONE:-us-central1-a}"
INSTANCE_NAME="${GCP_INSTANCE:-datavisor}"
MACHINE_TYPE="${GCP_MACHINE_TYPE:-e2-standard-4}"
DISK_SIZE="${GCP_DISK_SIZE:-50}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Provisioning DataVisor VM..."
echo "  Project:  $PROJECT_ID"
echo "  Zone:     $ZONE"
echo "  Instance: $INSTANCE_NAME"
echo "  Machine:  $MACHINE_TYPE"
echo "  Disk:     ${DISK_SIZE}GB"
echo ""

# Create VM with Ubuntu 24.04 LTS
gcloud compute instances create "$INSTANCE_NAME" \
  --project="$PROJECT_ID" \
  --zone="$ZONE" \
  --machine-type="$MACHINE_TYPE" \
  --image-family=ubuntu-2404-lts-amd64 \
  --image-project=ubuntu-os-cloud \
  --boot-disk-size="${DISK_SIZE}GB" \
  --boot-disk-type=pd-balanced \
  --tags=http-server,https-server \
  --metadata-from-file=startup-script="$SCRIPT_DIR/vm-startup.sh"

echo ""

# Create firewall rules for HTTP/HTTPS (idempotent -- ignores if already exists)
gcloud compute firewall-rules create allow-http-https \
  --project="$PROJECT_ID" \
  --allow=tcp:80,tcp:443 \
  --target-tags=http-server,https-server \
  --source-ranges=0.0.0.0/0 \
  --description="Allow HTTP/HTTPS for DataVisor" \
  2>/dev/null || echo "Firewall rule 'allow-http-https' already exists (OK)"

# Get external IP
EXTERNAL_IP=$(gcloud compute instances describe "$INSTANCE_NAME" \
  --project="$PROJECT_ID" \
  --zone="$ZONE" \
  --format="get(networkInterfaces[0].accessConfigs[0].natIP)")

echo ""
echo "VM provisioned successfully!"
echo ""
echo "External IP: $EXTERNAL_IP"
echo ""
echo "NEXT STEPS:"
echo "1. Wait 3-5 minutes for the startup script to install Docker and build images"
echo "2. SSH into the VM to configure auth:"
echo "   gcloud compute ssh $INSTANCE_NAME --project=$PROJECT_ID --zone=$ZONE"
echo "3. On the VM, create .env file:"
echo "   cd /opt/data-visor"
echo "   cp .env.example .env"
echo "   # Generate password hash:"
echo "   docker run --rm caddy:2-alpine caddy hash-password --plaintext 'your-password'"
echo "   # Edit .env and set AUTH_PASSWORD_HASH, DOMAIN (if using custom domain)"
echo "   nano .env"
echo "4. Start DataVisor:"
echo "   docker compose up -d --build"
echo "5. Access at: http://$EXTERNAL_IP (or https://yourdomain.com if DOMAIN is set)"
