import os
import tempfile
import unittest
from datetime import datetime
from unittest.mock import patch
os.environ['DATABASE_URL'] = 'sqlite:///' + tempfile.mktemp(suffix='.db')
os.environ['SHIFT_TIMEZONE'] = 'UTC'
from fastapi.testclient import TestClient
from app import app
from auth import password_hash
from database import SessionLocal, UserDB, InstanceDB, SnapshotDB
from engine import in_shift

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

if __name__ == '__main__': unittest.main()
