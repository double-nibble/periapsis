resource "aws_s3_bucket" "registry" {
  bucket = "periapsis-registry-${var.domain}"
}

resource "aws_s3_bucket_public_access_block" "registry" {
  bucket                  = aws_s3_bucket.registry.id
  block_public_acls       = true
  block_public_policy      = false
  ignore_public_acls      = true
  restrict_public_buckets = false
}

# The registry holds only public keys; served read-only through CloudFront.
data "aws_iam_policy_document" "registry_read" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.registry.arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.registry.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "registry" {
  bucket = aws_s3_bucket.registry.id
  policy = data.aws_iam_policy_document.registry_read.json
}

resource "aws_acm_certificate" "registry" {
  provider          = aws.us_east_1
  domain_name       = local.registry_fqdn
  validation_method = "DNS"
}

resource "aws_route53_record" "registry_validation" {
  for_each = {
    for o in aws_acm_certificate.registry.domain_validation_options : o.domain_name => o
  }
  zone_id = var.zone_id
  name    = each.value.resource_record_name
  type    = each.value.resource_record_type
  records = [each.value.resource_record_value]
  ttl     = 60
}

resource "aws_acm_certificate_validation" "registry" {
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.registry.arn
  validation_record_fqdns = [for r in aws_route53_record.registry_validation : r.fqdn]
}

resource "aws_cloudfront_origin_access_control" "registry" {
  name                              = "periapsis-registry"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "registry" {
  enabled             = true
  default_root_object = "registry.json"
  aliases             = [local.registry_fqdn]

  origin {
    domain_name              = aws_s3_bucket.registry.bucket_regional_domain_name
    origin_id                = "registry-s3"
    origin_access_control_id = aws_cloudfront_origin_access_control.registry.id
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "registry-s3"
    viewer_protocol_policy = "https-only"
    min_ttl                = 0
    default_ttl            = 60
    max_ttl                = 300
    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.registry.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

resource "aws_route53_record" "registry" {
  zone_id = var.zone_id
  name    = local.registry_fqdn
  type    = "A"
  alias {
    name                   = aws_cloudfront_distribution.registry.domain_name
    zone_id                = aws_cloudfront_distribution.registry.hosted_zone_id
    evaluate_target_health = false
  }
}
