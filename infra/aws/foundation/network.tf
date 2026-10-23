provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile
  default_tags {
    tags = {
      Project   = "sales-ai"
      ManagedBy = "Terraform"
    }
  }
}

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

data "aws_availability_zones" "available" {
  state = "available"
  filter {
    name   = "zone-type"
    values = ["availability-zone"]
  }
}

data "aws_ec2_instance_type_offerings" "workers" {
  location_type = "availability-zone"
  filter {
    name   = "instance-type"
    values = [var.worker_instance_type]
  }
}

locals {
  zones = {
    for index, zone in slice(data.aws_availability_zones.available.names, 0, 2) : zone => index
  }
  admin_principal = coalesce(var.admin_principal_arn, data.aws_caller_identity.current.arn)
}

resource "aws_vpc" "this" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags = {
    Name = format("%s-vpc", var.cluster_name)
  }
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags = {
    Name = format("%s-igw", var.cluster_name)
  }
}

resource "aws_subnet" "public" {
  for_each                = local.zones
  vpc_id                  = aws_vpc.this.id
  availability_zone       = each.key
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, each.value)
  map_public_ip_on_launch = false
  tags = {
    Name                                                   = format("%s-public-%s", var.cluster_name, each.key)
    "kubernetes.io/role/elb"                               = "1"
    (format("kubernetes.io/cluster/%s", var.cluster_name)) = "shared"
  }
}

resource "aws_subnet" "private" {
  for_each                = local.zones
  vpc_id                  = aws_vpc.this.id
  availability_zone       = each.key
  cidr_block              = cidrsubnet(var.vpc_cidr, 4, each.value + 2)
  map_public_ip_on_launch = false
  tags = {
    Name                                                   = format("%s-private-%s", var.cluster_name, each.key)
    "kubernetes.io/role/internal-elb"                      = "1"
    (format("kubernetes.io/cluster/%s", var.cluster_name)) = "shared"
  }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id
  tags = {
    Name = format("%s-public", var.cluster_name)
  }
}

resource "aws_route" "public_internet" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.this.id
}

resource "aws_route_table_association" "public" {
  for_each       = local.zones
  subnet_id      = aws_subnet.public[each.key].id
  route_table_id = aws_route_table.public.id
}

resource "aws_eip" "nat" {
  for_each = local.zones
  domain   = "vpc"
  tags = {
    Name = format("%s-nat-%s", var.cluster_name, each.key)
  }
}

resource "aws_nat_gateway" "this" {
  for_each      = local.zones
  allocation_id = aws_eip.nat[each.key].id
  subnet_id     = aws_subnet.public[each.key].id
  depends_on    = [aws_internet_gateway.this]
  tags = {
    Name = format("%s-nat-%s", var.cluster_name, each.key)
  }
}

resource "aws_route_table" "private" {
  for_each = local.zones
  vpc_id   = aws_vpc.this.id
  tags = {
    Name = format("%s-private-%s", var.cluster_name, each.key)
  }
}

resource "aws_route" "private_internet" {
  for_each               = local.zones
  route_table_id         = aws_route_table.private[each.key].id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.this[each.key].id
}

resource "aws_route_table_association" "private" {
  for_each       = local.zones
  subnet_id      = aws_subnet.private[each.key].id
  route_table_id = aws_route_table.private[each.key].id
}
