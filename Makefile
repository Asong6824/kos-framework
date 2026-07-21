.PHONY: check dev-check eval process-eval process-eval-validate test test-init scan agent-build agent-test agent-check ob-plugin-check mvp-package release-check kos-test-build kos-test-reset kos-test clean

PYTHON ?= python3
VAULT := vault
KOS_TEST_VAULT ?= $(abspath ../kos-test)
PI ?= pi

check: agent-build
	node agent/packages/kos-agent/dist/kos-cli.js validate --root $(VAULT)

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

test-init: agent-build
	rm -rf /tmp/kos-framework-test
	PYTHONDONTWRITEBYTECODE=1 $(PYTHON) dev/harness/init_vault.py /tmp/kos-framework-test
	node agent/packages/kos-agent/dist/kos-cli.js validate --root /tmp/kos-framework-test

scan:
	PYTHONDONTWRITEBYTECODE=1 $(PYTHON) dev/harness/scan_sensitive.py

agent-build:
	npm run build --prefix agent

agent-test:
	npm run test --prefix agent

agent-check: agent-build agent-test

ob-plugin-check:
	npm run typecheck --prefix ob-plugin
	npm run test --prefix ob-plugin
	npm run build --prefix ob-plugin

mvp-package: agent-build ob-plugin-check
	node dev/harness/build_ob_plugin_release.mjs

release-check: check dev-check test test-init scan agent-check ob-plugin-check mvp-package

kos-test-build:
	PYTHONDONTWRITEBYTECODE=1 $(PYTHON) dev/harness/kos_test.py prepare --target "$(KOS_TEST_VAULT)"

kos-test-reset:
	PYTHONDONTWRITEBYTECODE=1 $(PYTHON) dev/harness/kos_test.py prepare --target "$(KOS_TEST_VAULT)" --reset

kos-test:
	PI_AGENT_BIN="$(PI)" PYTHONDONTWRITEBYTECODE=1 $(PYTHON) dev/harness/kos_test.py run --target "$(KOS_TEST_VAULT)"

clean:
	find . -type d -name __pycache__ -prune -exec rm -rf {} +
	find . -type f -name '*.pyc' -delete
