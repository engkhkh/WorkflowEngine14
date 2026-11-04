# Workflow ERP - Java desktop (Swing)

No dependencies, only a JDK 17+.

    ./build.sh            (Windows: build.bat)
    java -jar workflow-erp.jar

Server address is asked on the login window (default `http://localhost:63353`); the session is remembered in `~/.workflow_erp_swing.json`.
Try without the real backend: `python3 ../tools/mock_server.py 5055`, sign in as admin / admin on `http://localhost:5055`.
