output "broker_url" {
  description = "NATS broker URL (secure WebSocket) for hub and reporters"
  value       = "wss://${local.broker_fqdn}"
}

output "registry_url" {
  description = "Registry URL for hub and reporters"
  value       = "https://${local.registry_fqdn}/registry.json"
}

output "registry_bucket" {
  description = "S3 bucket the signed registry is uploaded to"
  value       = aws_s3_bucket.registry.id
}

output "broker_instance_id" {
  description = "Broker instance id (for SSM session access)"
  value       = aws_instance.broker.id
}
