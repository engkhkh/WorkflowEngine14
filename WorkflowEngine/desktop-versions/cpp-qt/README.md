# Workflow ERP - C++ desktop (Qt 6 Widgets)

Needs Qt 6 (Widgets, Network), CMake 3.16+ and a C++17 compiler.

    cmake -S . -B build -DCMAKE_PREFIX_PATH=/path/to/Qt/6.x/gcc_64    (Windows: ...\msvc2019_64)
    cmake --build build
    ./build/workflow-erp

Linux packages: `sudo apt install qt6-base-dev cmake build-essential`.
Server address is asked on the login window (default `http://localhost:63353`); the session is remembered with QSettings.
Try without the real backend: `python3 ../tools/mock_server.py 5055`, sign in as admin / admin on `http://localhost:5055`.
