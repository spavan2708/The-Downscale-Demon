import os
import boto3
from moto import mock_aws

os.environ["AWS_ACCESS_KEY_ID"] = "mock_key"
os.environ["AWS_SECRET_ACCESS_KEY"] = "mock_secret"
os.environ["AWS_DEFAULT_REGION"] = "us-east-1"

class DownscaleDemonEngine:
    def __init__(self):
        self.mock = mock_aws()
        self.mock.start()
        self.ec2 = boto3.client("ec2", region_name="us-east-1")
        
        self.cost_table = {
            "t3.medium": 0.0416,
            "c5.xlarge": 0.1700,
            "idle_ipv4": 0.0050
        }
        self.snoozed_instances = {}
        self._seed_mock_fleet()

    def _seed_mock_fleet(self):
        """Provisions realistic mock servers and explicitly assigns tags."""
        # 1. Active Dev Sandbox
        dev_res = self.ec2.run_instances(ImageId="ami-01234567", InstanceType="t3.medium", MinCount=1, MaxCount=1)
        dev_id = dev_res["Instances"][0]["InstanceId"]
        self.ec2.create_tags(Resources=[dev_id], Tags=[
            {"Key": "Name", "Value": "Dev-Sandbox-ActiveBuild"},
            {"Key": "FinOps:Exempt", "Value": "False"}
        ])

        # 2. Production Staging Server (Exempt)
        staging_res = self.ec2.run_instances(ImageId="ami-01234567", InstanceType="c5.xlarge", MinCount=1, MaxCount=1)
        staging_id = staging_res["Instances"][0]["InstanceId"]
        self.ec2.create_tags(Resources=[staging_id], Tags=[
            {"Key": "Name", "Value": "Staging-Demo-Server"},
            {"Key": "FinOps:Exempt", "Value": "True"}
        ])

        # 3. Idle Abandoned Sandbox with Static IPv4
        idle_res = self.ec2.run_instances(ImageId="ami-01234567", InstanceType="t3.medium", MinCount=1, MaxCount=1)
        idle_id = idle_res["Instances"][0]["InstanceId"]
        self.ec2.create_tags(Resources=[idle_id], Tags=[
            {"Key": "Name", "Value": "Dev-Sandbox-Abandoned"},
            {"Key": "FinOps:Exempt", "Value": "False"}
        ])

        eip = self.ec2.allocate_address(Domain="vpc")
        self.ec2.associate_address(InstanceId=idle_id, AllocationId=eip["AllocationId"])

    def _extract_tags(self, inst):
        tags = {}
        for t in inst.get("Tags", []):
            tags[t["Key"]] = t["Value"]
        return tags

    def get_instances(self):
        reservations = self.ec2.describe_instances().get("Reservations", [])
        fleet = []
        for r in reservations:
            for inst in r["Instances"]:
                tags = self._extract_tags(inst)
                fleet.append({
                    "id": inst["InstanceId"],
                    "name": tags.get("Name", "Unknown"),
                    "type": inst["InstanceType"],
                    "state": inst["State"]["Name"],
                    "exempt": str(tags.get("FinOps:Exempt", "")).lower() == "true",
                    "snoozed": self.snoozed_instances.get(inst["InstanceId"], False)
                })
        return fleet

    def evaluate_and_downscale(self, instance_id, is_busy=False):
        desc = self.ec2.describe_instances(InstanceIds=[instance_id])
        inst = desc["Reservations"][0]["Instances"][0]
        tags = self._extract_tags(inst)

        if self.snoozed_instances.get(instance_id, False):
            return {"status": "SNOOZED", "reason": "Snoozed by developer via ChatOps/UI."}

        # Feature 4: Tag Check
        if str(tags.get("FinOps:Exempt", "")).lower() == "true":
            return {"status": "BYPASS", "reason": "Protected by FinOps:Exempt tag. Shutdown skipped."}

        # Heuristic 2-B: Build inspection
        if is_busy:
            return {"status": "DEFERRED", "reason": "Active compilation/test jobs in progress."}

        # Feature 2: Release IP & Safe Stop
        addresses = self.ec2.describe_addresses().get("Addresses", [])
        for addr in addresses:
            if addr.get("InstanceId") == instance_id:
                self.ec2.disassociate_address(AssociationId=addr["AssociationId"])

        self.ec2.stop_instances(InstanceIds=[instance_id])
        hourly = self.cost_table.get(inst["InstanceType"], 0.05)
        saved = round(14 * (hourly + self.cost_table["idle_ipv4"]), 2)

        return {
            "status": "DOWNSCALED",
            "reason": "Machine idle and non-exempt. Cut-off executed.",
            "daily_saved_usd": saved
        }

    def wake_instance(self, instance_id):
        self.ec2.start_instances(InstanceIds=[instance_id])
        return {"status": "RUNNING", "reason": "Knock-to-Wake intercepted inbound traffic."}

    def toggle_snooze(self, instance_id):
        current = self.snoozed_instances.get(instance_id, False)
        self.snoozed_instances[instance_id] = not current
        return {"snoozed": not current}