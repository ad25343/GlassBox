dev:
	@echo "Starting GlassBox..."
	@trap 'kill 0' SIGINT; \
	uvicorn backend.main:app --reload --port 8888 & \
	cd ui && npm run dev & \
	wait

install:
	pip install -r requirements.txt
	cd ui && npm install

.PHONY: dev install
