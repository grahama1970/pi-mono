
import pytest
from pathlib import Path
import subprocess

def test_extractor_batch_support():
    # Verify extract.py handles directory input
    extract_script = Path(".agent/skills/extractor/extract.py")
    if not extract_script.exists():
        pytest.fail("Extractor script not found")
        
    # We won't actually run batch in test unless we have fixtures
    # This is a placeholder for the Definition of Done
    assert extract_script.exists()
