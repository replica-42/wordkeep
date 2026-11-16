"""Public package imports and editable installation."""

import os
import subprocess
import sys


def test_package_import_does_not_initialize_hanlp(tmp_path) -> None:
    subprocess.run(
        [
            sys.executable,
            "-c",
            "import sys; import wordkeep_backend; assert 'hanlp' not in sys.modules",
        ],
        cwd=tmp_path,
        check=True,
    )


def test_core_import_remains_independent_of_interfaces_and_model_runtime(tmp_path):
    script = """
import json
import sys
from importlib.metadata import distribution
import wordkeep_backend
from wordkeep_backend import core
assert wordkeep_backend.TextAnalyzer is core.TextAnalyzer
assert "wordkeep_backend.interfaces" not in sys.modules
assert "hanlp" not in sys.modules
assert "matplotlib" not in sys.modules
installed = json.loads(distribution("wordkeep-backend").read_text("direct_url.json"))
assert installed["dir_info"]["editable"] is True
"""
    subprocess.run(
        [sys.executable, "-c", script],
        cwd=tmp_path,
        env={
            **{key: value for key, value in os.environ.items() if key != "PYTHONPATH"},
            "PYTHONDONTWRITEBYTECODE": "1",
            "OMP_NUM_THREADS": "2",
            "MKL_NUM_THREADS": "2",
        },
        check=True,
        timeout=15,
    )
