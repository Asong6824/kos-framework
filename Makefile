.PHONY: check dev-check eval process-eval process-eval-validate test test-init scan release-check kos-test-build kos-test-reset kos-test clean

PYTHON ?= python3
VAULT := vault
KOS_TEST_VAULT ?= $(abspath ../kos-test)
PI ?= pi

check:
	PYTHONDONTWRITEBYTECODE=1 $(PYTHON) $(VAULT)/90_系统/harness/validate_paths.py --root $(VAULT) --format markdown
	PYTHONDONTWRITEBYTECODE=1 $(PYTHON) $(VAULT)/90_系统/harness/validate_schema.py --root $(VAULT) --format markdown
	PYTHONDONTWRITEBYTECODE=1 $(PYTHON) $(VAULT)/90_系统/harness/validate_state.py --root $(VAULT) --format markdown
	PYTHONDONTWRITEBYTECODE=1 $(PYTHON) $(VAULT)/90_系统/harness/validate_permissions.py --root $(VAULT) --format markdown
	PYTHONDONTWRITEBYTECODE=1 $(PYTHON) $(VAULT)/90_系统/harness/validate_skills.py --root $(VAULT) --format markdown
	PYTHONDONTWRITEBYTECODE=1 $(PYTHON) $(VAULT)/90_系统/harness/validate_skill_evals.py --root $(VAULT) --format markdown

eval:
	PYTHONDONTWRITEBYTECODE=1 $(PYTHON) dev/harness/validate_core_evals.py

dev-check:
	PYTHONDONTWRITEBYTECODE=1 $(PYTHON) dev/harness/validate_distribution.py
	PYTHONDONTWRITEBYTECODE=1 $(PYTHON) dev/harness/validate_core_evals.py
	PYTHONDONTWRITEBYTECODE=1 $(PYTHON) dev/harness/validate_process_evals.py

process-eval-validate:
	PYTHONDONTWRITEBYTECODE=1 $(PYTHON) dev/harness/validate_process_evals.py

process-eval:
	PI_AGENT_BIN="$(PI)" PYTHONDONTWRITEBYTECODE=1 $(PYTHON) dev/harness/run_process_evals.py --pi "$(PI)"

test:
	PYTHONDONTWRITEBYTECODE=1 $(PYTHON) -m unittest discover -s dev/tests -p 'test_*.py'

test-init:
	rm -rf /tmp/kos-framework-test
	PYTHONDONTWRITEBYTECODE=1 $(PYTHON) dev/harness/init_vault.py /tmp/kos-framework-test
	cd /tmp/kos-framework-test && PYTHONDONTWRITEBYTECODE=1 $(PYTHON) 90_系统/harness/generate_health_report.py

scan:
	PYTHONDONTWRITEBYTECODE=1 $(PYTHON) dev/harness/scan_sensitive.py

release-check: check dev-check test test-init scan

kos-test-build:
	PYTHONDONTWRITEBYTECODE=1 $(PYTHON) dev/harness/kos_test.py prepare --target "$(KOS_TEST_VAULT)"

kos-test-reset:
	PYTHONDONTWRITEBYTECODE=1 $(PYTHON) dev/harness/kos_test.py prepare --target "$(KOS_TEST_VAULT)" --reset

kos-test:
	PI_AGENT_BIN="$(PI)" PYTHONDONTWRITEBYTECODE=1 $(PYTHON) dev/harness/kos_test.py run --target "$(KOS_TEST_VAULT)"

clean:
	find . -type d -name __pycache__ -prune -exec rm -rf {} +
	find . -type f -name '*.pyc' -delete
