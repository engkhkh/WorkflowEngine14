# Workflow ERP - Python desktop (PySide6 / Qt)

    pip install -r requirements.txt
    python main.py

Server address is asked on the login window (default `http://localhost:63353`). The session is remembered in `~/.workflow_erp_pyside6.json`.
Left menu: Home, Approvals, Documents, ERP (module tree + table + record editor), Settings (English / Arabic with right-to-left, sign out).
Try it without the real backend: `python ../tools/mock_server.py 5055` then sign in as admin / admin on `http://localhost:5055`.
