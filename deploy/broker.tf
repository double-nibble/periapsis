data "aws_ami" "al2023_arm" {
  most_recent = true
  owners      = ["amazon"]
  filter {
    name   = "name"
    values = ["al2023-ami-*-arm64"]
  }
}

resource "aws_security_group" "broker" {
  name        = "periapsis-broker"
  description = "NATS broker: client port from allowed CIDRs only"

  ingress {
    description = "NATS TLS"
    from_port   = 4222
    to_port     = 4222
    protocol    = "tcp"
    cidr_blocks = var.allowed_cidrs
  }

  # Port 80 for certbot's HTTP-01 challenge (issuance and renewal).
  ingress {
    description = "ACME HTTP-01 challenge"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# SSM access instead of an open SSH port.
resource "aws_iam_role" "broker" {
  name = "periapsis-broker"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.broker.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "broker" {
  name = "periapsis-broker"
  role = aws_iam_role.broker.name
}

resource "aws_instance" "broker" {
  ami                    = data.aws_ami.al2023_arm.id
  instance_type          = var.instance_type
  vpc_security_group_ids = [aws_security_group.broker.id]
  iam_instance_profile   = aws_iam_instance_profile.broker.name

  user_data = templatefile("${path.module}/user-data/broker.sh.tftpl", {
    fqdn  = local.broker_fqdn
    email = var.letsencrypt_email
  })

  tags = { Name = "periapsis-broker" }
}

resource "aws_eip" "broker" {
  instance = aws_instance.broker.id
}

resource "aws_route53_record" "broker" {
  zone_id = var.zone_id
  name    = local.broker_fqdn
  type    = "A"
  ttl     = 300
  records = [aws_eip.broker.public_ip]
}
