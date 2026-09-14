import os
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
os.environ['DATABASE_URL'] = 'sqlite:///' + tempfile.mktemp(suffix='.db')
from fastapi.testclient import TestClient
from app import app

class ChiefSignupTests(unittest.TestCase):
    def test_first_admin_only(self):
        body = {'user_id': 'CHIEF-1', 'name': 'Chief', 'password': 'test-password-123'}
        with TestClient(app) as client:
            self.assertEqual(client.post('/api/auth/signup/chief-architect', json={**body, 'role': 'admin'}).status_code, 422)
            self.assertEqual(client.post('/api/auth/signup/chief-architect', json={**body, 'password': 'short'}).status_code, 422)
            def create(uid):
                return client.post('/api/auth/signup/chief-architect', json={**body, 'user_id': uid})
            with ThreadPoolExecutor(max_workers=2) as pool:
                responses = list(pool.map(create, ['CHIEF-1', 'CHIEF-2']))
            self.assertEqual(sorted(r.status_code for r in responses), [201, 409])
            data = next(r.json() for r in responses if r.status_code == 201)
            self.assertEqual(data['user']['role'], 'admin')
            self.assertEqual(data['user']['team_id'], 'platform')
            headers = {'Authorization': 'Bearer ' + data['access_token']}
            self.assertEqual(client.get('/api/me', headers=headers).json()['id'], data['user']['id'])
            self.assertEqual(client.get('/api/instances', headers=headers).json()['fleet'], [])
            self.assertEqual(client.post('/api/auth/login', json={**body, 'user_id': data['user']['id']}).status_code, 200)
            self.assertEqual(create('CHIEF-3').status_code, 409)

if __name__ == '__main__': unittest.main()
