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
from database import SessionLocal, UserDB, InstanceDB, SnapshotDB, RuntimeIntervalDB, EventDB
from engine import (
    LifecycleError,
    _attach_volume,
    complete_buffered_request,
    in_shift,
    queue_request_and_wake,
    runtime_summary,
    safe_downscale,
    terminate_workspace,
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
            fleet.send_json({'type':'PING','sent_at':123})
            pong = fleet.receive_json()
            self.assertEqual(pong['type'], 'PONG')
            self.assertEqual(pong['sent_at'], 123)
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
        self.assertEqual(data['analytics']['snapshot_monthly'],0)
        self.assertEqual(len(data['snapshots']),1)
        self.assertIsNone(data['snapshots'][0]['size_mb'])
        self.assertIsNone(data['snapshots'][0]['memory_footprint_mb'])
        self.assertIsNone(data['snapshots'][0]['tmux_panes'])
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
            self.assertTrue(db.query(RuntimeIntervalDB).filter_by(instance_id='a', state='running').count())

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

    def test_12_employee_inbox_and_team_requests(self):
        announcement = self.client.post(
            '/api/announcements',
            headers=self.headers('admin'),
            json={'category': 'maintenance', 'title': 'Routine maintenance', 'body': 'Workspace maintenance is scheduled for the platform team.'},
        )
        self.assertEqual(announcement.status_code, 201)
        request = self.client.post(
            '/api/support/requests',
            headers=self.headers('a'),
            json={
                'request_type': 'overtime',
                'subject': 'Overtime for release',
                'details': 'Please approve two hours for the release validation window.',
                'instance_id': 'a',
            },
        )
        self.assertEqual(request.status_code, 201)
        self.assertEqual(request.json()['status'], 'open')
        self.assertEqual(request.json()['extension_hours'], 2)
        with SessionLocal() as db:
            db.get(InstanceDB, 'a').shift_start = '09:00'
            db.get(InstanceDB, 'a').shift_end = '18:00'
            db.commit()
        team_inbox = self.client.get('/api/employee/inbox', headers=self.headers('lead')).json()
        self.assertEqual(team_inbox['requests'][0]['id'], request.json()['id'])
        decision = self.client.post(
            f"/api/support/requests/{request.json()['id']}/decision",
            headers=self.headers('lead'),
            json={'status': 'approved', 'response': 'Approved for two hours.'},
        )
        self.assertEqual(decision.status_code, 200)
        employee_inbox = self.client.get('/api/employee/inbox', headers=self.headers('a')).json()
        self.assertTrue(any(item['title'] == 'Routine maintenance' for item in employee_inbox['announcements']))
        self.assertTrue(any(item['title'] == 'Overtime request approved' for item in employee_inbox['announcements']))
        other_team = self.client.post(
            '/api/announcements',
            headers=self.headers('admin'),
            json={'category': 'announcement', 'title': 'Private team update', 'body': 'This announcement is scoped to team B.', 'team_id': 'B'},
        )
        self.assertEqual(other_team.status_code, 201)
        employee_inbox = self.client.get('/api/employee/inbox', headers=self.headers('a')).json()
        self.assertFalse(any(item['title'] == 'Private team update' for item in employee_inbox['announcements']))

    def test_12a_dedicated_overtime_endpoints_update_shift_and_reject_cross_team(self):
        with SessionLocal() as db:
            instance = db.get(InstanceDB, 'a')
            instance.shift_start = '09:00'
            instance.shift_end = '18:00'
            db.commit()
        request = self.client.post(
            '/api/support/requests',
            headers=self.headers('a'),
            json={
                'request_type': 'overtime',
                'subject': 'Release validation overtime',
                'details': 'Request an additional two hours for verification.',
                'instance_id': 'a',
                'extension_hours': 2,
            },
        )
        self.assertEqual(request.status_code, 201)
        approved = self.client.post(
            f"/api/requests/{request.json()['id']}/approve",
            headers=self.headers('lead'),
            json={},
        )
        self.assertEqual(approved.status_code, 200)
        self.assertEqual(approved.json()['shift_end'], '20:00')
        self.assertEqual(approved.json()['request']['status'], 'approved')
        duplicate = self.client.post(
            f"/api/requests/{request.json()['id']}/approve",
            headers=self.headers('lead'),
            json={},
        )
        self.assertEqual(duplicate.status_code, 409)

        other_team_request = self.client.post(
            '/api/support/requests',
            headers=self.headers('b'),
            json={
                'request_type': 'overtime',
                'subject': 'Weekend support overtime',
                'details': 'Request two hours for weekend support.',
                'instance_id': 'b',
                'extension_hours': 2,
            },
        )
        self.assertEqual(other_team_request.status_code, 201)
        denied = self.client.post(
            f"/api/requests/{other_team_request.json()['id']}/reject",
            headers=self.headers('lead'),
            json={},
        )
        self.assertEqual(denied.status_code, 404)

    def test_13_governance_runtime_summary_uses_state_intervals(self):
        instance = SimpleNamespace(
            id='runtime-test',
            state='running',
            state_since='2026-01-01T03:00:00+00:00',
            instance_type='t3.medium',
        )
        with SessionLocal() as db:
            db.add(RuntimeIntervalDB(
                instance_id='runtime-test',
                state='hibernated',
                started_at='2026-01-01T00:00:00+00:00',
                ended_at='2026-01-01T03:00:00+00:00',
            ))
            summary = runtime_summary(db, [instance], datetime.fromisoformat('2026-01-01T05:00:00+00:00'))
            self.assertEqual(summary['workspaces'][0]['active_hours'], 2.0)
            self.assertEqual(summary['workspaces'][0]['hibernated_hours'], 3.0)
            self.assertEqual(summary['workspaces'][0]['today_active_hours'], 2.0)
            self.assertEqual(summary['workspaces'][0]['today_hibernated_hours'], 3.0)
            self.assertAlmostEqual(
                summary['today_estimated_credits_preserved_usd'], 0.1248,
            )
            self.assertEqual(summary['workspaces'][0]['tracked_hours'], 5.0)
            self.assertAlmostEqual(summary['baseline_compute_usd'], 0.208)
            self.assertAlmostEqual(summary['managed_compute_usd'], 0.0832)
            db.rollback()
        self.assertEqual(self.client.get('/api/governance/overview', headers=self.headers('a')).status_code, 403)
        overview = self.client.get('/api/governance/overview', headers=self.headers('lead'))
        self.assertEqual(overview.status_code, 200)
        self.assertTrue(any(employee['id'] == 'a' for employee in overview.json()['employees']))

    def test_13a_runtime_summary_clips_today_at_configured_timezone_midnight(self):
        instance = SimpleNamespace(
            id='timezone-runtime-test',
            state='running',
            state_since='2026-01-01T00:00:00+00:00',
            instance_type='t3.medium',
        )
        with SessionLocal() as db:
            db.add(RuntimeIntervalDB(
                instance_id=instance.id,
                state='hibernated',
                started_at='2025-12-31T17:00:00+00:00',
                ended_at='2026-01-01T00:00:00+00:00',
            ))
            with patch.dict(os.environ, {'SHIFT_TIMEZONE': 'Asia/Kolkata'}):
                summary = runtime_summary(
                    db, [instance], datetime.fromisoformat('2026-01-01T05:00:00+00:00'),
                )
            self.assertEqual(summary['daily_tracking_timezone'], 'Asia/Kolkata')
            self.assertEqual(summary['today_hibernated_hours'], 5.5)
            self.assertEqual(summary['today_active_hours'], 5.0)
            db.rollback()

    def test_14_employee_lockout_revokes_sessions_and_downscales(self):
        from starlette.websockets import WebSocketDisconnect

        with self.client.websocket_connect('/ws/fleet') as employee_socket:
            employee_socket.send_json({'token': self.tokens['a']})
            self.assertEqual(employee_socket.receive_json()['reason'], 'connected')
            with self.client.websocket_connect('/ws/fleet') as admin_socket:
                admin_socket.send_json({'token': self.tokens['admin']})
                self.assertEqual(admin_socket.receive_json()['reason'], 'connected')
                response = self.client.post(
                    '/api/employees/a/access',
                    headers=self.headers('lead'),
                    json={'blocked': True},
                )
                self.assertEqual(response.status_code, 200)
                self.assertTrue(response.json()['access_blocked'])
                self.assertEqual(admin_socket.receive_json()['type'], 'ACCESS_BLOCKED')
                self.assertEqual(admin_socket.receive_json()['type'], 'SESSION_TERMINATED')
            with self.assertRaises(WebSocketDisconnect) as context:
                employee_socket.receive_json()
            self.assertEqual(context.exception.code, 4401)
        self.assertEqual(self.client.get('/api/instances', headers=self.headers('a')).status_code, 401)
        self.assertEqual(self.client.post(
            '/api/auth/login',
            json={'user_id': 'a', 'password': 'test-password-123'},
        ).status_code, 403)
        self.assertEqual(self.client.post(
            '/api/employees/b/access',
            headers=self.headers('lead'),
            json={'blocked': True},
        ).status_code, 404)
        restored = self.client.post(
            '/api/employees/a/access',
            headers=self.headers('lead'),
            json={'blocked': False},
        )
        self.assertEqual(restored.status_code, 200)
        self.assertFalse(restored.json()['access_blocked'])
        self.assertEqual(self.client.post(
            '/api/auth/login',
            json={'user_id': 'a', 'password': 'test-password-123'},
        ).status_code, 200)

    def test_15_workspace_delete_requires_chief_confirmation(self):
        url = '/api/workspaces/b'
        wrong = self.client.request('DELETE', url, headers=self.headers('admin'), json={'confirmation_name': 'wrong'})
        self.assertEqual(wrong.status_code, 409)
        denied = self.client.request('DELETE', url, headers=self.headers('lead'), json={'confirmation_name': 'Workspace b'})
        self.assertEqual(denied.status_code, 403)
        with self.client.websocket_connect('/ws/fleet') as admin_socket:
            admin_socket.send_json({'token': self.tokens['admin']})
            self.assertEqual(admin_socket.receive_json()['reason'], 'connected')
            deleted = self.client.request('DELETE', url, headers=self.headers('admin'), json={'confirmation_name': 'Workspace b'})
            self.assertEqual(deleted.status_code, 200)
            self.assertEqual(deleted.json()['status'], 'DELETED')
            self.assertEqual(admin_socket.receive_json()['type'], 'FLEET_UPDATED')
        self.assertNotIn('b', {item['id'] for item in self.client.get('/api/instances', headers=self.headers('admin')).json()['fleet']})
        with SessionLocal() as db:
            event = db.query(EventDB).filter_by(event_type='FLEET_UPDATED', instance_id=None).order_by(EventDB.id.desc()).first()
            self.assertIsNotNone(event)

    def test_16_aws_termination_orders_checkpoint_detach_before_terminate(self):
        ec2 = MagicMock()
        ec2.describe_instances.return_value = {'Reservations': [{
            'Instances': [{'State': {'Name': 'running'}}],
        }]}
        ec2.describe_volumes.return_value = {'Volumes': [{
            'State': 'available',
            'Attachments': [],
        }]}
        calls = []
        ec2.detach_volume.side_effect = lambda **kwargs: calls.append('detach')
        ec2.stop_instances.side_effect = lambda **kwargs: calls.append('stop')
        ec2.terminate_instances.side_effect = lambda **kwargs: calls.append('terminate')

        def downscale(instance, snapshot_id):
            calls.append('checkpoint')
            ec2.detach_volume(VolumeId=instance.aws_volume_id, InstanceId=instance.aws_instance_id, Force=False)
            ec2.stop_instances(InstanceIds=[instance.aws_instance_id])
            ec2.get_waiter('instance_stopped').wait(InstanceIds=[instance.aws_instance_id])
            return '/mnt/checkpoints/delete', 128.0, 8.0, '12 1 service'

        with SessionLocal() as db:
            instance = InstanceDB(
                id='aws-delete-test',
                aws_instance_id='i-12345678',
                aws_volume_id='vol-12345678',
                name='AWS delete test',
                owner_id='admin',
                instance_type='t3.medium',
                state='running',
            )
            db.add(instance)
            db.flush()
            with patch.dict(os.environ, {'AWS_LIFECYCLE_ENABLED': '1'}), patch(
                'engine._aws_client', return_value=ec2,
            ), patch('engine._aws_downscale', side_effect=downscale):
                terminate_workspace(db, instance)
            self.assertEqual(instance.state, 'stopped')
            self.assertEqual(calls, ['checkpoint', 'detach', 'stop', 'terminate'])
            ec2.terminate_instances.assert_called_once_with(InstanceIds=['i-12345678'])
            db.rollback()

    def test_17_finops_websocket_pushes_without_new_events(self):
        clock = MagicMock(side_effect=[0, 0] + [11] * 100)
        with patch('app.time', SimpleNamespace(monotonic=clock)):
            with self.client.websocket_connect('/ws/fleet') as socket:
                socket.send_json({'token': self.tokens['admin']})
                self.assertEqual(socket.receive_json()['reason'], 'connected')
                update = socket.receive_json()
                self.assertEqual(update['type'], 'FINOPS_UPDATED')
                self.assertIn('today_active_hours', update['runtime'])
                self.assertIn('today_hibernated_hours', update['runtime'])
                self.assertIn('today_estimated_credits_preserved_usd', update['runtime'])
                self.assertEqual(update['runtime']['daily_tracking_timezone'], 'UTC')

    def test_18_aws_termination_sdk_errors_return_explicit_failure(self):
        from botocore.exceptions import ClientError

        with SessionLocal() as db:
            instance = db.get(InstanceDB, 'a')
            instance.aws_instance_id = 'i-12345678'
            db.commit()
        ec2 = MagicMock()
        ec2.describe_instances.side_effect = ClientError(
            {'Error': {'Code': 'UnauthorizedOperation', 'Message': 'not authorized'}},
            'DescribeInstances',
        )
        with patch.dict(os.environ, {'AWS_LIFECYCLE_ENABLED': '1'}), patch(
            'engine._aws_client', return_value=ec2,
        ):
            response = self.client.request(
                'DELETE',
                '/api/workspaces/a',
                headers=self.headers('admin'),
                json={'confirmation_name': 'Workspace a'},
            )
        self.assertEqual(response.status_code, 503)
        self.assertIn('UnauthorizedOperation', response.json()['detail'])
        with SessionLocal() as db:
            db.get(InstanceDB, 'a').aws_instance_id = None
            db.commit()

    def test_zz_assignment_and_client_telemetry(self):
        from datetime import timezone
        def receive_type(socket, expected):
            for _ in range(20):
                frame = socket.receive_json()
                if frame['type'] == expected:
                    return frame
            self.fail(f'Missing WebSocket frame: {expected}')

        self.tokens['a'] = self.client.post('/api/auth/login', json={
            'user_id': 'a', 'password': 'test-password-123',
        }).json()['access_token']
        created = self.client.post('/api/workspaces', headers=self.headers('admin'), json={
            'name': 'Client telemetry regression', 'instance_type': 't3.medium',
            'shift_start': '00:00', 'shift_end': '00:00',
        })
        self.assertEqual(created.status_code, 201)
        identifier = created.json()['instance_id']
        endpoint = f'/api/workspaces/{identifier}/assign'
        self.assertEqual(self.client.post(endpoint, headers=self.headers('a'), json={'user_id': 'a'}).status_code, 403)
        self.assertEqual(self.client.post(endpoint, headers=self.headers('admin'), json={'user_id': 'a'}).status_code, 200)
        self.assertEqual(self.client.post(endpoint, headers=self.headers('admin'), json={'user_id': 'b'}).status_code, 409)
        for uid, visible in [('a', True), ('lead', True), ('b', False)]:
            fleet = self.client.get('/api/instances', headers=self.headers(uid)).json()['fleet']
            self.assertEqual(identifier in {item['id'] for item in fleet}, visible)
        for command, state in [('Wake', 'running'), ('Sleep', 'hibernated'), ('Terminate', 'stopped')]:
            response = self.client.post('/api/instance/state', headers=self.headers('a'), json={
                'instance_id': identifier, 'target_state': command,
            })
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()['new_state'], state)
        packet = {'type': 'TELEMETRY', 'instance_id': identifier, 'cpu_percent': 42,
                  'memory_mb': 1024, 'memory_percent': 50,
                  'observed_at': datetime.now(timezone.utc).isoformat()}
        with patch('app.telemetry_cache') as cache:
            with self.client.websocket_connect('/ws/fleet') as admin_socket:
                admin_socket.send_json({'token': self.tokens['admin']})
                self.assertEqual(admin_socket.receive_json()['reason'], 'connected')
                with self.client.websocket_connect('/ws/fleet') as client_socket:
                    client_socket.send_json({'token': self.tokens['a']})
                    self.assertEqual(client_socket.receive_json()['reason'], 'connected')
                    client_socket.send_json(packet)
                    self.assertTrue(receive_type(client_socket, 'TELEMETRY_ACK')['accepted'])
                    for _ in range(20):
                        update = admin_socket.receive_json()
                        if update['type'] == 'TELEMETRY_UPDATED':
                            break
                    self.assertEqual(update['telemetry'][0]['instance_id'], identifier)
                    self.assertEqual(update['telemetry'][0]['memory_mb'], 1024)
                    # Drain the sender's event before checking subsequent replies.
                    receive_type(client_socket, 'TELEMETRY_UPDATED')
                    client_socket.send_json(packet)
                    self.assertFalse(receive_type(client_socket, 'TELEMETRY_ACK')['accepted'])
                    client_socket.send_json({**packet, 'cpu_percent': 101})
                    self.assertEqual(receive_type(client_socket, 'ERROR')['status'], 422)
                    client_socket.send_json({**packet, 'observed_at': datetime.now().isoformat()})
                    self.assertEqual(receive_type(client_socket, 'ERROR')['status'], 422)
                    client_socket.send_json({**packet, 'instance_id': 'b'})
                    self.assertEqual(receive_type(client_socket, 'ERROR')['status'], 404)
            cache.setex.assert_called_once()
        with SessionLocal() as db:
            instance = db.get(InstanceDB, identifier)
            self.assertEqual(instance.cpu_load, 42)
            self.assertEqual(instance.memory_usage_mb, 1024)
            instance.state = 'running'
            db.commit()
        from scheduler import evaluate_shifts
        with patch('scheduler.cloud_metrics', return_value={'cpu': None}) as cloud:
            evaluate_shifts()
            self.assertNotIn(identifier, [call.args[0].id for call in cloud.call_args_list])
        with SessionLocal() as db:
            instance = db.get(InstanceDB, identifier)
            self.assertEqual(instance.memory_usage_mb, 1024)
            self.assertEqual(instance.telemetry_updated_at, packet['observed_at'])
            db.delete(instance)
            db.commit()

if __name__ == '__main__': unittest.main()
