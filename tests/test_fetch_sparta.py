import unittest
from unittest.mock import patch
import subprocess
import json

class TestFetchSparta(unittest.TestCase):

    @patch('subprocess.check_output')
    def test_fetch_sparta_dry_run(self, mock_check_output):
        # Mock the subprocess call to simulate the script execution
        mock_check_output.return_value = b"https://example.com/nist1\nhttps://example.com/nist2\nhttps://example.com/nist3\n"

        # Execute the script with --dry-run
        result = subprocess.check_output([
            ".agent/skills/fetcher/scripts/fetch_sparta.py",
            "--control-type", "NIST",
            "--dry-run"
        ])

        # Assert the output
        self.assertEqual(result.strip(), b"https://example.com/nist1\nhttps://example.com/nist2\nhttps://example.com/nist3")

    @patch('subprocess.check_output')
    def test_fetch_sparta_manifest(self, mock_check_output):
        # Mock the subprocess call to simulate the script execution
        mock_check_output.return_value = b'{"urls": ["https://example.com/nist1", "https://example.com/nist2", "https://example.com/nist3"]}\nCalling fetcher...\n'

        # Execute the script without --dry-run
        result = subprocess.check_output([
            ".agent/skills/fetcher/scripts/fetch_sparta.py",
            "--control-type", "NIST"
        ])

        # Assert the output
        expected_manifest = {"urls": ["https://example.com/nist1", "https://example.com/nist2", "https://example.com/nist3"]}
        self.assertTrue(json.loads(result.decode('utf-8').splitlines()[0]) == expected_manifest)


if __name__ == '__main__':
    unittest.main()
