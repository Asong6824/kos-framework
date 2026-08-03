.PHONY: setup install release-archives check dev-check eval process-eval process-eval-validate test test-init scan agent-build agent-test agent-check ob-plugin-check new-user-sync-check mvp-package release-check kos-test-build kos-test-reset kos-test clean

PYTHON ?= python3
VAULT := vault
KOS_TEST_VAULT ?= $(abspath ../kos-test)
PI ?= pi
KOS_VAULT ?= $(abspath ../kos)
KOS_NEW_USER_VAULT_A ?= $(abspath ../kos-new-user-a)
KOS_NEW_USER_VAULT_B ?= $(abspath ../kos-new-user-b)

setup:
	npm ci --prefix agent --ignore-scripts
	npm ci --prefix ob-plugin --ignore-scripts

install:
	node dev/harness/install_local.mjs "$(KOS_VAULT)"

release-archives: mvp-package
	node dev/harness/install_local.mjs "$(KOS_VAULT)" --skip-deps
	$(PYTHON) dev/harness/build_release_archives.py "$(KOS_VAULT)"

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
	npm run test:livesync --prefix ob-plugin
	npm run build --prefix ob-plugin

new-user-sync-check:
	KOS_NEW_USER_VAULT_A="$(KOS_NEW_USER_VAULT_A)" KOS_NEW_USER_VAULT_B="$(KOS_NEW_USER_VAULT_B)" node dev/harness/verify_new_user_sync.mjs

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
