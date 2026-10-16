variable "region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "domain" {
  description = "Root domain you control in Route53, e.g. double-nibble.com"
  type        = string
}

variable "zone_id" {
  description = "Route53 hosted zone id for the domain"
  type        = string
}

variable "broker_subdomain" {
  description = "Subdomain for the NATS broker"
  type        = string
  default     = "api"
}

variable "registry_subdomain" {
  description = "Subdomain for the public-key registry"
  type        = string
  default     = "status"
}

variable "allowed_cidrs" {
  description = "Source CIDRs allowed to reach the broker (your hub and reporters)"
  type        = list(string)
}

variable "instance_type" {
  description = "Broker instance type"
  type        = string
  default     = "t4g.nano"
}

variable "letsencrypt_email" {
  description = "Email for Let's Encrypt registration on the broker cert"
  type        = string
}

variable "aws_profile" {
  description = "AWS profile for credentials. Defaults to the terraform-login profile that bridges an aws login session."
  type        = string
  default     = "terraform-login"
}

variable "vpc_id" {
  description = "VPC to place the broker in. Must have an internet gateway."
  type        = string
}

variable "subnet_id" {
  description = "A public subnet in that VPC (route table has 0.0.0.0/0 to the IGW, auto-assign public IP). The broker has no internet otherwise."
  type        = string
}
