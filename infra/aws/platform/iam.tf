resource "aws_iam_role" "controllers" {
  for_each = local.service_accounts
  name     = format("%s-%s", local.platform.cluster_name, each.key)
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRoleWithWebIdentity"
      Principal = { Federated = local.platform.oidc_provider_arn }
      Condition = {
        StringEquals = {
          (format("%s:aud", local.platform.oidc_host)) = "sts.amazonaws.com"
          (format("%s:sub", local.platform.oidc_host)) = format("system:serviceaccount:kube-system:%s", each.value)
        }
      }
    }]
  })
}

resource "aws_iam_policy" "load_balancer" {
  name   = format("%s-load-balancer-controller", local.platform.cluster_name)
  policy = file(format("%s/policies/load-balancer-controller.json", path.module))
}

resource "aws_iam_role_policy_attachment" "load_balancer" {
  role       = aws_iam_role.controllers["load_balancer"].name
  policy_arn = aws_iam_policy.load_balancer.arn
}

resource "aws_iam_role_policy" "autoscaler" {
  name = "cluster-scoped-autoscaling"
  role = aws_iam_role.controllers["autoscaler"].name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "autoscaling:SetDesiredCapacity",
          "autoscaling:TerminateInstanceInAutoScalingGroup",
        ]
        Resource = "*"
        Condition = {
          StringEquals = {
            "aws:ResourceTag/k8s.io/cluster-autoscaler/enabled"                                   = "true"
            (format("aws:ResourceTag/k8s.io/cluster-autoscaler/%s", local.platform.cluster_name)) = "owned"
          }
        }
      },
      {
        Effect = "Allow"
        Action = [
          "autoscaling:DescribeAutoScalingGroups",
          "autoscaling:DescribeAutoScalingInstances",
          "autoscaling:DescribeLaunchConfigurations",
          "autoscaling:DescribeScalingActivities",
          "autoscaling:DescribeTags",
          "ec2:DescribeImages",
          "ec2:DescribeInstanceTypes",
          "ec2:DescribeLaunchTemplateVersions",
          "ec2:GetInstanceTypesFromInstanceRequirements",
          "eks:DescribeNodegroup",
        ]
        Resource = "*"
      },
    ]
  })
}
