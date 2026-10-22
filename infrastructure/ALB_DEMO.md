# ALB demo deployment

The dashboard now uses same-origin `/api/` and `/ws/` requests in production. Nginx on port 3000 proxies those paths to FastAPI on the Compose network. The ALB therefore needs one HTTP target group on EC2 port 3000. This is an **HTTP-only demonstration** and must not be used to enroll workspace agents or transmit agent credentials. Agent control stays disabled.

The EC2 host has no AWS instance role or AWS CLI credentials. To create the ALB with AWS Console access:

1. In CloudFormation, choose **Create stack → With new resources → Upload a template file**, and upload `infrastructure/alb-http-demo.yaml` in region `ap-southeast-2`.
2. Use stack name `downscale-demon-alb-demo`. Confirm the default VPC, first subnet, instance, and instance security group match the current EC2 host. Select `PublicSubnetB` in a **different Availability Zone** in the same VPC. It must be public with an internet-gateway route.
3. Create the stack. When complete, open the `DashboardUrl` output. The target group must show the EC2 instance as **healthy**.
4. In browser DevTools Network, verify `/api/instances` and `/ws/fleet` use the ALB hostname, then sign in to the Demon dashboard and observe a workspace update. The local Client portal still points directly to the EC2 API until its configuration is updated separately.

The template adds an ingress rule from the ALB security group to the instance security group on port 3000. Compose binds PostgreSQL and Redis only to EC2 localhost, but the existing security-group rules should still be reviewed. The template does not remove existing direct access to ports 3000 or 8000. After the ALB demonstration and before any real agent enrollment, add a trusted HTTPS listener and WSS, route the Client through it, and close the direct public ports. Never enable `AGENT_CONTROL_ENABLED` on the current HTTP endpoint.
