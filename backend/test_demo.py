import os
import tempfile
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

os.environ['DATABASE_URL'] = 'sqlite:///' + tempfile.mktemp(suffix='.db')
os.environ['SHIFT_TIMEZONE'] = 'Asia/Kolkata'
os.environ['DEMO_MODE'] = '1'
from fastapi.testclient import TestClient
from app import app
from database import SessionLocal, UserDB, InstanceDB, SnapshotDB
from auth import password_hash
from engine import snapshot_payload
from scheduler import evaluate_shifts

class DemoTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)
        with SessionLocal() as db:
            for uid in ('owner', 'other'):
                db.add(UserDB(id=uid, name=uid, role='employee', password_hash=password_hash('demo-password-123')))
            db.commit()
        token = cls.client.post('/api/auth/login', json={'user_id':'owner', 'password':'demo-password-123'}).json()['access_token']
        cls.headers = {'Authorization': 'Bearer ' + token}

    def setUp(self):
        with SessionLocal() as db:
            db.query(SnapshotDB).delete()
            db.query(InstanceDB).delete()
            for uid in ('owner', 'other'):
                db.add(InstanceDB(id=uid, name=uid, owner_id=uid, state='running', instance_type='t3.medium', shift_start='09:00', shift_end='18:00'))
            db.commit()

    def configure(self, **values):
        return self.client.post('/api/instance/demo', headers=self.headers, json={
            'instance_id':'owner', 'enabled':True, 'simulated_time':'2026-09-20T12:00', **values})

    def test_scope_validation_and_server_gate(self):
        self.assertEqual(self.configure(instance_id='other').status_code, 404)
        self.assertEqual(self.configure(cpu=101).status_code, 422)
        self.assertEqual(self.configure(activity='stopped').status_code, 422)
        self.assertEqual(self.configure(simulated_time='bad-date').status_code, 422)
        with patch.dict(os.environ, {'DEMO_MODE':'0'}):
            self.assertEqual(self.configure().status_code, 403)
        self.assertEqual(self.client.post('/api/instance/demo', json={'instance_id':'owner','enabled':True}).status_code, 401)

    def test_immediate_cutoff_and_snapshot_timestamps(self):
        self.assertEqual(self.configure(cpu=99.8).json()['instance']['cpu'],99.8)
        result = self.configure(simulated_time='2026-09-20T18:00', cpu=99.8, evaluate_now=True)
        self.assertEqual(result.status_code,200)
        self.assertEqual(result.json()['instance']['state'],'hibernated')
        data = self.client.get('/api/instances',headers=self.headers).json()
        snapshot = data['snapshots'][0]
        self.assertEqual(snapshot['simulated_at'],'2026-09-20T18:00:00+05:30')
        actual = datetime.fromisoformat(snapshot['created_at'])
        self.assertLess(abs((datetime.now(timezone.utc)-actual).total_seconds()),30)
        self.assertIn('_20260920_180000_',snapshot['filename'])
        self.configure(evaluate_now=True,simulated_time='2026-09-20T18:00')
        self.assertEqual(len(self.client.get('/api/instances',headers=self.headers).json()['snapshots']),1)
        with SessionLocal() as db:
            self.assertEqual(db.get(InstanceDB,'other').state,'running')

    def test_cpu_idle_and_regular_scheduler_use_same_clock(self):
        result=self.configure(cpu=0,activity='idle',evaluate_now=True).json()
        self.assertEqual(result['instance']['state'],'idle')
        self.assertGreater(result['instance']['cost'],0)
        result=self.configure(cpu=99.8,simulated_time='2026-09-20T20:00').json()
        self.assertTrue(result['instance']['anomaly'])
        evaluate_shifts()
        with SessionLocal() as db:
            self.assertEqual(db.get(InstanceDB,'owner').state,'hibernated')

    def test_disable_restores_real_clock_and_wake_checks_demo_clock(self):
        self.configure()
        with patch('engine.system_now',return_value=datetime(2026,9,20,20,tzinfo=timezone.utc)):
            result=self.configure(enabled=False).json()['instance']
            self.assertFalse(result['demo_enabled'])
            self.assertIsNone(result['demo_time'])
            self.assertEqual(result['state'],'hibernated')
            self.configure(simulated_time='2026-09-20T12:00')
            result=self.client.post('/api/instance/state',headers=self.headers,json={'instance_id':'owner','target_state':'running'})
            self.assertEqual(result.status_code,200)

    def test_legacy_date_has_no_invented_time(self):
        value=snapshot_payload(SnapshotDB(id='legacy', filename='SNAPSHOT_hail_mary_20260920.IMG'))
        self.assertIsNone(value['created_at'])
        self.assertEqual(value['legacy_date'],'2026-09-20')

if __name__ == '__main__': unittest.main()
