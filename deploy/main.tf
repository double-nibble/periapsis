terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region  = var.region
  profile = var.aws_profile
}

# CloudFront + ACM for the registry must be in us-east-1.
provider "aws" {
  alias   = "us_east_1"
  region  = "us-east-1"
  profile = var.aws_profile
}

locals {
  broker_fqdn   = "${var.broker_subdomain}.${var.domain}"
  registry_fqdn = "${var.registry_subdomain}.${var.domain}"
}
