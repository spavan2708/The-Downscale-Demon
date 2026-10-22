import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

os.environ['DATABASE_URL'] = 'sqlite:///' + tempfile.mktemp(suffix='.db')
os.environ['SHIFT_TIMEZONE'] = 'UTC'

from fastapi.testclient import TestClient
from app import app
from auth import password_hash
from database import AgentCommandDB, InstanceDB, SessionLocal, SnapshotDB, UserDB
from agent_control import enqueue_pause, next_command
from scheduler import evaluate_shifts


class AgentTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        with SessionLocal() as db:
            db.add(UserDB(id='chief', name='Chief', role='admin', team_id='team',
                          password_hash=password_hash('test-password-123')))
            db.add(UserDB(id='employee', name='Employee', role='employee', team_id='team',
                          password_hash=password_hash('test-password-123')))
            db.add(InstanceDB(id='work', name='Work', owner_id='employee',
                              state='running', instance_type='t3.medium',
                              shift_start='00:00', shift_end='00:00'))
            db.commit()
        self.admin = self.client.post('/api/auth/login', json={
            'user_id': 'chief', 'password': 'test-password-123',
        }).json()['access_token']
        self.employee = self.client.post('/api/auth/login', json={
            'user_id': 'employee', 'password': 'test-password-123',
        }).json()['access_token']
        self.flags = patch.dict(os.environ, {'AGENT_CONTROL_ENABLED': '1',
                                              'AGENT_IDLE_ENABLED': '1',
                                              'AGENT_ALLOW_INSECURE': '1'})
        self.flags.start()

    def tearDown(self):
        self.flags.stop()
        with SessionLocal() as db:
            db.query(AgentCommandDB).delete()
            db.query(SnapshotDB).delete()
            db.query(InstanceDB).delete()
            db.query(UserDB).delete()
            db.commit()

    def credential(self):
        response = self.client.post('/api/workspaces/work/agent-credential',
                                    headers={'Authorization': 'Bearer ' + self.admin})
        self.assertEqual(response.status_code, 200)
        return response.json()['agent_token']

    def test_agent_telemetry_and_command(self):
        denied = self.client.post('/api/workspaces/work/agent-credential',
                                  headers={'Authorization': 'Bearer ' + self.employee})
        self.assertEqual(denied.status_code, 403)
        token = self.credential()
        with self.client.websocket_connect('/ws/agent/work') as socket:
            socket.send_json({'token': token})
            self.assertEqual(socket.receive_json()['type'], 'AGENT_CONNECTED')
            observation = datetime.now(timezone.utc).isoformat()
            packet = {'type': 'TELEMETRY', 'cpu_percent': 2, 'memory_mb': 512,
                      'observed_at': observation, 'user_active': False}
            socket.send_json(packet)
            self.assertTrue(socket.receive_json()['accepted'])
            socket.send_json(packet)
            self.assertFalse(socket.receive_json()['accepted'])
            with SessionLocal() as db:
                enqueue_pause(db, 'work')
                db.commit()
            message = socket.receive_json()
            self.assertEqual(message['type'], 'COMMAND')
            socket.send_json({'type': 'COMMAND_ACK', 'id': message['id'], 'prepared': True})
            self.assertEqual(socket.receive_json()['status'], 'completed')
            socket.send_json({'type': 'COMMAND_ACK', 'id': message['id'], 'prepared': True})
            self.assertEqual(socket.receive_json()['status'], 'completed')
        with SessionLocal() as db:
            self.assertEqual(db.get(InstanceDB, 'work').state, 'hibernated')
            self.assertEqual(db.query(SnapshotDB).filter_by(instance_id='work').count(), 1)

    def test_idle_requires_fresh_activity_and_no_portal(self):
        self.credential()
        current = datetime.now(timezone.utc)
        with SessionLocal() as db:
            instance = db.get(InstanceDB, 'work')
            instance.cpu_load = 2
            instance.telemetry_updated_at = current.isoformat()
            instance.activity_observed_at = current.isoformat()
            instance.portal_activity_at = current.isoformat()
            instance.low_cpu_since = (current - timedelta(minutes=16)).isoformat()
            db.commit()
        with patch('scheduler.in_shift', return_value=True):
            evaluate_shifts()
        with SessionLocal() as db:
            self.assertEqual(db.query(AgentCommandDB).count(), 0)
            db.get(InstanceDB, 'work').portal_activity_at = (current - timedelta(minutes=3)).isoformat()
            db.commit()
        with patch('scheduler.in_shift', return_value=True):
            evaluate_shifts()
        with SessionLocal() as db:
            self.assertEqual(db.query(AgentCommandDB).count(), 1)
            db.get(InstanceDB, 'work').activity_observed_at = (current - timedelta(minutes=4)).isoformat()
            db.query(AgentCommandDB).delete()
            db.commit()
        with patch('scheduler.in_shift', return_value=True):
            evaluate_shifts()
        with SessionLocal() as db:
            self.assertEqual(db.query(AgentCommandDB).count(), 0)

    def test_retry_limit_and_rotation(self):
        old_token = self.credential()
        new_token = self.credential()
        from agent_control import valid_credential
        self.assertFalse(valid_credential('work', old_token))
        self.assertTrue(valid_credential('work', new_token))
        with SessionLocal() as db:
            enqueue_pause(db, 'work')
            db.commit()
        for attempt in range(3):
            self.assertIsNotNone(next_command('work'))
            with SessionLocal() as db:
                command = db.query(AgentCommandDB).first()
                command.updated_at = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
                db.commit()
        self.assertIsNone(next_command('work'))
        with SessionLocal() as db:
            self.assertEqual(db.query(AgentCommandDB).first().status, 'failed')

    def test_manual_sleep_waits_for_agent_and_failed_prepare_keeps_running(self):
        token = self.credential()
        response = self.client.post('/api/instance/state',
            headers={'Authorization': 'Bearer ' + self.employee},
            json={'instance_id': 'work', 'target_state': 'hibernated'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['status'], 'PENDING')
        with SessionLocal() as db:
            self.assertEqual(db.get(InstanceDB, 'work').state, 'running')
        with self.client.websocket_connect('/ws/agent/work') as socket:
            socket.send_json({'token': token})
            self.assertEqual(socket.receive_json()['type'], 'AGENT_CONNECTED')
            command = socket.receive_json()
            socket.send_json({'type': 'COMMAND_ACK', 'id': command['id'],
                              'prepared': False, 'detail': 'No checkpoint hook'})
            self.assertEqual(socket.receive_json()['status'], 'pending')
        with SessionLocal() as db:
            self.assertEqual(db.get(InstanceDB, 'work').state, 'running')
            self.assertEqual(db.query(SnapshotDB).count(), 0)


if __name__ == '__main__':
    unittest.main()
