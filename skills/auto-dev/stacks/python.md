# Tech Stack: Python

## Variables
- language: Python
- build_cmd: python -m py_compile {changed_files}
- test_cmd: pytest -q
- test_single_cmd: pytest {test_file} -q
- lang_checklist: code-review-common.md
- test_dir: tests/
- source_dir: src/ or project root

## Build Notes
- Check pyproject.toml or setup.py for Python version requirements
- Use virtual environment: `source venv/bin/activate` or `poetry shell`
- Type checking: `mypy {changed_files}` if mypy is configured

## Test Notes
- Check for pytest, unittest, or nose configuration
- Look for conftest.py for fixtures
- Coverage: `pytest --cov={package} -q`
