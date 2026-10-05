import unittest
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image

from app import app


class BackendTests(unittest.TestCase):
    def test_routes_and_assets(self):
        with TestClient(app) as client:
            self.assertEqual(client.get('/health').json(), {'status': 'ok'})
            self.assertIn('Your virtual fitting room', client.get('/').text)
            for path in ['style.css', 'app.js', 'pose.js', 'shirts/black_tshirt.png', 'shirts/white_tshirt.png', 'shirts/blue_tshirt.png', 'shirts/red_tshirt.png']:
                self.assertEqual(client.get('/static/' + path).status_code, 200)
            self.assertEqual(client.post('/health', content=b'frame').status_code, 405)
            self.assertEqual(client.get('/static/missing.png').status_code, 404)

    def test_garments_have_transparent_background_and_neck(self):
        for path in (Path(__file__).resolve().parents[1] / 'static/shirts').glob('*.png'):
            with Image.open(path) as image:
                self.assertEqual(image.mode, 'RGBA')
                self.assertEqual(image.size, (600,650))
                self.assertEqual(image.getpixel((0,0))[3], 0)
                self.assertEqual(image.getpixel((300,85))[3], 0)
                self.assertEqual(image.getpixel((300,300))[3], 255)


if __name__ == '__main__':
    unittest.main()
