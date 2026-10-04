import json
import tempfile
import unittest
from pathlib import Path

# Import through the gateway tests' isolated data directory configuration.
import os
os.environ.setdefault('HARBOR_DATA', tempfile.mkdtemp())
import server


class ProjectConfigTests(unittest.TestCase):
    def load(self, value):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'projects.json'
            path.write_text(json.dumps(value))
            return server.load_project_settings(path)

    def test_missing_configuration_is_optional(self):
        self.assertEqual(server.load_project_settings(Path('/nonexistent/harbor-project-settings.json')), {})

    def test_external_https_settings(self):
        settings = self.load({'portal': {'name': 'Secure portal', 'externalUrl': 'https://portal.example.com/login', 'secret': 'ignored'}})
        self.assertEqual(settings['portal']['name'], 'Secure portal')
        self.assertNotIn('secret', settings['portal'])

    def test_unsafe_external_links_are_rejected(self):
        for url in ['javascript:alert(1)', 'http://portal.example.com', 'https://user:password@portal.example.com', 'https:///missing-host']:
            with self.subTest(url=url), self.assertRaises(ValueError):
                self.load({'portal': {'externalUrl': url}})

    def test_invalid_shape_is_rejected(self):
        for value in [[], {'portal': 'invalid'}]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.load(value)

    def test_unlabelled_containers_use_their_own_names(self):
        self.assertEqual(server.group({'Names': ['/standalone-worker'], 'Labels': {}}), 'standalone-worker')


if __name__ == '__main__':
    unittest.main()
