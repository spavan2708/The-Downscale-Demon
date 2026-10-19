import os
import tempfile
import unittest
import json
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
os.environ['DATABASE_URL'] = 'sqlite:///' + tempfile.mktemp(suffix='.db')
os.environ['SHIFT_TIMEZONE'] = 'UTC'
from fastapi.testclient import TestClient
from app import app
from auth import password_hash
from database import SessionLocal, UserDB, InstanceDB, SnapshotDB
from engine import (
    LifecycleError,
    _attach_volume,
    complete_buffered_request,
    in_shift,
    queue_request_and_wake,
    safe_downscale,
)

class IntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)
        with SessionLocal() as db:
            for uid,role,team in [('admin','admin','A'),('lead','manager','A'),('a','employee','A'),('b','employee','B')]:
                db.add(UserDB(id=uid,name=uid,role=role,team_id=team,password_hash=password_hash('test-password-123')))
            for uid in ['a','b']:
                db.add(InstanceDB(id=uid, name=f'Workspace {uid}', owner_id=uid,instance_type='t3.medium',state='running',shift_start='00:00',shift_end='00:00'))
            db.commit()
        cls.tokens = {uid:cls.client.post('/api/auth/login',json={'user_id':uid,'password':'test-password-123'}).json()['access_token'] for uid in ['admin','lead','a','b']}
    def headers(self,uid): return {'Authorization':'Bearer '+self.tokens[uid]}
    def test_01_isolation(self):
        self.assertEqual(self.client.get('/api/instances').status_code,401)
        for uid,expected in [('a',{'a'}),('lead',{'a'}),('admin',{'a','b'})]:
            self.assertEqual({i['id'] for i in self.client.get('/api/instances',headers=self.headers(uid)).json()['fleet']},expected)
        for endpoint,extra in [('/api/instance/state',{'target_state':'hibernated'}),('/api/instance/anomaly-simulate',{}),('/api/shift/update',{'shift_start':'09:00','shift_end':'18:00'}),('/api/logout',{})]:
            self.assertIn(self.client.post(endpoint,headers=self.headers('a'),json={'instance_id':'b',**extra}).status_code,[403,404])
        self.assertEqual(self.client.post('/api/auth/login',json={'user_id':'admin','password':'wrong'}).status_code,401)
    def test_02_provision(self):
        req={'user_id':'new','name':'New','password':'long-password-123','team_id':'B','instances':[{'name':'New workspace','instance_type':'r5.large'}]}
        self.assertEqual(self.client.post('/api/employees',headers=self.headers('lead'),json=req).status_code,403)
        req['team_id']='A'
        self.assertEqual(self.client.post('/api/employees',headers=self.headers('a'),json=req).status_code,403)
        self.assertEqual(self.client.post('/api/employees',headers=self.headers('lead'),json=req).status_code,201)
        self.assertEqual(self.client.post('/api/employees',headers=self.headers('lead'),json=req).status_code,409)
    def test_03_shifts_and_anomaly(self):
        inst=InstanceDB(shift_start='22:00',shift_end='06:00',is_exempt=False,is_snoozed=False)
        for hour,expected in [(23,True),(2,True),(6,False),(12,False)]:
            self.assertEqual(in_shift(inst,datetime(2026,1,1,hour)),expected)
        with SessionLocal() as db:
            inst=db.get(InstanceDB,'a'); inst.shift_start='09:00'; inst.shift_end='18:00'; db.commit()
        for hour,expected in [(12,False),(20,True)]:
            with patch('engine.system_now',return_value=datetime(2026,1,1,hour)):
                response=self.client.post('/api/instance/anomaly-simulate',headers=self.headers('a'),json={'instance_id':'a'})
                self.assertEqual(response.json()['off_hours_threat'],expected)
    def test_04_purge_and_billing(self):
        with self.client.websocket_connect('/ws/fleet') as fleet:
            fleet.send_json({'token':self.tokens['a']})
            self.assertEqual(fleet.receive_json()['reason'],'connected')
            self.client.post('/api/instance/state',headers=self.headers('b'),json={'instance_id':'b','target_state':'hibernated'})
            with self.client.websocket_connect('/ws/criu-dump/a') as dump:
                dump.send_json({'token':self.tokens['lead']})
                self.assertIn('SIMULATED',dump.receive_text())
                self.assertIn('SNAPSHOT_Workspace_a_',dump.receive_text())
            message=fleet.receive_json()
            self.assertEqual(message['type'],'SESSION_TERMINATED'); self.assertEqual(message['instance_id'],'a')
            self.assertIn('analytics', message)
        data=self.client.get('/api/instances',headers=self.headers('a')).json()
        self.assertEqual(data['analytics']['compute_hourly'],0)
        self.assertGreater(data['analytics']['snapshot_monthly'],0)
        self.assertEqual(len(data['snapshots']),1)
        self.assertAlmostEqual(data['analytics']['snapshot_monthly'],34.2/1024*.05,places=6)
        other=self.client.get('/api/instances',headers=self.headers('b')).json()
        self.assertTrue(all(s['instance_id'] == 'b' for s in other['snapshots']))
    def test_05_ws_denial(self):
        from starlette.websockets import WebSocketDisconnect
        with self.client.websocket_connect('/ws/criu-dump/b') as ws:
            ws.send_json({'token':self.tokens['lead']})
            with self.assertRaises(WebSocketDisconnect) as context: ws.receive_text()
            self.assertEqual(context.exception.code,4404)

    def test_06_scheduler(self):
        from scheduler import evaluate_shifts
        with SessionLocal() as db:
            inst=db.get(InstanceDB,'b'); inst.state='running'; inst.shift_start='22:00'; inst.shift_end='06:00'; db.commit()
        with patch('engine.system_now',return_value=datetime(2026,1,1,2)):
            evaluate_shifts()
        with SessionLocal() as db: self.assertEqual(db.get(InstanceDB,'b').state,'running')
        with patch('engine.system_now',return_value=datetime(2026,1,1,6)):
            evaluate_shifts()
        with SessionLocal() as db: self.assertEqual(db.get(InstanceDB,'b').state,'hibernated')

    def test_07_signup(self):
        req={'user_id':'invitee','team_id':'B','instances':[{'name':'Invited workspace','instance_type':'t3.medium'}]}
        self.assertEqual(self.client.post('/api/invitations',headers=self.headers('lead'),json=req).status_code,403)
        req['team_id']='A'
        self.assertEqual(self.client.post('/api/invitations',headers=self.headers('a'),json=req).status_code,403)
        result=self.client.post('/api/invitations',headers=self.headers('lead'),json=req)
        self.assertEqual(result.status_code,201)
        body={'user_id':'invitee','name':'Invited Employee','password':'signup-password-123','invitation_token':result.json()['invitation_token']}
        self.assertEqual(self.client.post('/api/auth/signup',json={**body,'role':'admin'}).status_code,422)
        self.assertEqual(self.client.post('/api/auth/signup',json={**body,'user_id':'wrong'}).status_code,400)
        self.assertEqual(self.client.post('/api/auth/signup',json={**body,'invitation_token':'invalid'}).status_code,400)
        signed=self.client.post('/api/auth/signup',json=body)
        self.assertEqual(signed.status_code,201)
        self.assertEqual(signed.json()['user']['role'],'employee')
        self.assertEqual(signed.json()['user']['team_id'],'A')
        fleet=self.client.get('/api/instances',headers={'Authorization':'Bearer '+signed.json()['access_token']}).json()['fleet']
        self.assertEqual(len(fleet),1)
        self.assertEqual(fleet[0]['owner'],'invitee')
        self.assertEqual(fleet[0]['state'],'hibernated')
        self.assertEqual(self.client.post('/api/auth/signup',json=body).status_code,400)
        self.assertEqual(self.client.post('/api/auth/login',json={'user_id':'invitee','password':body['password']}).status_code,200)
        req['user_id']='expired'
        invitation=self.client.post('/api/invitations',headers=self.headers('admin'),json=req).json()
        from database import InvitationDB
        with SessionLocal() as db:
            db.query(InvitationDB).filter_by(user_id='expired').update({'expires_at':0}); db.commit()
        self.assertEqual(self.client.post('/api/auth/signup',json={**body,'user_id':'expired','invitation_token':invitation['invitation_token']}).status_code,400)

    def test_08_edge_queue_and_wake_wrapper(self):
        sqs = MagicMock()
        def receive_message(**kwargs):
            envelope = json.loads(sqs.send_message.call_args.kwargs['MessageBody'])
            return {'Messages': [{
                'Body': json.dumps(envelope),
                'ReceiptHandle': 'receipt',
            }]}
        sqs.receive_message.side_effect = receive_message
        instance = SimpleNamespace(
            id='workspace',
            aws_instance_id='i-12345678',
            state='hibernated',
        )
        with patch.dict(os.environ, {
            'AWS_LIFECYCLE_ENABLED': '1',
            'REQUEST_QUEUE_URL': 'https://sqs.us-east-1.amazonaws.com/123/requests',
        }), patch('engine._aws_client', return_value=sqs), patch('engine.wake_instance') as wake:
            request_id = queue_request_and_wake(None, instance, {'method': 'GET', 'path': '/health'})
        self.assertTrue(request_id)
        sqs.send_message.assert_called_once()
        envelope = json.loads(sqs.send_message.call_args.kwargs['MessageBody'])
        self.assertEqual(envelope['request_id'], request_id)
        self.assertEqual(envelope['request']['path'], '/health')
        sqs.receive_message.side_effect = receive_message
        with patch.dict(os.environ, {
            'AWS_LIFECYCLE_ENABLED': '1',
            'REQUEST_QUEUE_URL': 'https://sqs.us-east-1.amazonaws.com/123/requests',
        }), patch('engine._aws_client', return_value=sqs):
            complete_buffered_request(request_id)
        sqs.delete_message.assert_called_once()
        wake.assert_called_once_with(None, instance)

    def test_09_downscale_persists_criu_metadata(self):
        with SessionLocal() as db:
            db.query(SnapshotDB).filter_by(instance_id='a').delete()
            instance = db.get(InstanceDB, 'a')
            instance.state = 'running'
            with patch.dict(os.environ, {'AWS_LIFECYCLE_ENABLED': '1'}), patch(
                'engine._aws_downscale',
                return_value=('/mnt/checkpoints/capture-1', 512.0, 20.0, '100 1 bash'),
            ):
                filename = safe_downscale(db, instance)
                db.commit()
            snapshot = db.query(SnapshotDB).filter_by(instance_id='a').one()
            self.assertTrue(filename.startswith('SNAPSHOT_Workspace_a_'))
            self.assertEqual(snapshot.memory_footprint_mb, 512)
            self.assertEqual(snapshot.size_mb, 20)
            self.assertEqual(snapshot.snapshot_ref, '/mnt/checkpoints/capture-1')
            self.assertEqual(json.loads(snapshot.process_tree), '100 1 bash')
            self.assertEqual(instance.state, 'hibernated')

    def test_10_ebs_attachment_must_belong_to_workspace(self):
        instance = SimpleNamespace(
            id='workspace',
            aws_instance_id='i-12345678',
            aws_volume_id='vol-12345678',
        )
        ec2 = MagicMock()
        ec2.describe_volumes.return_value = {'Volumes': [{
            'State': 'in-use',
            'Attachments': [{
                'State': 'attached',
                'InstanceId': 'i-87654321',
            }],
        }]}
        with patch('engine._aws_client', return_value=ec2):
            with self.assertRaises(LifecycleError):
                _attach_volume(ec2, instance)
        ec2.attach_volume.assert_not_called()

    def test_11_proxy_is_disabled_without_explicit_aws_opt_in(self):
        with patch.dict(os.environ, {'AWS_LIFECYCLE_ENABLED': '0'}):
            response = self.client.get('/proxy/a/health', headers=self.headers('a'))
        self.assertEqual(response.status_code, 503)

if __name__ == '__main__': unittest.main()
