cmake_minimum_required(VERSION 3.16)
project(WorkflowErpQt LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)

find_package(Qt6 REQUIRED COMPONENTS Widgets Network PrintSupport)

add_executable(workflow-erp
    src/main.cpp src/Api.cpp src/I18n.cpp src/Ui.cpp src/Pages.cpp src/RecordDialog.cpp src/MainWindow.cpp src/ChatPage.cpp src/WorkflowPage.cpp src/Prayer.cpp src/MuslimPage.cpp src/Forms.cpp src/MushafText.cpp src/Bi.cpp src/Charts.cpp src/Dashboard.cpp src/ReportDialog.cpp src/Pos.cpp src/Hospital.cpp src/CalendarPage.cpp src/Finance.cpp src/HrPage.cpp src/OpsPage.cpp src/SiteRender.cpp src/SitePage.cpp src/CustomPage.cpp src/AdminPage.cpp src/ActionsPage.cpp src/Xlsx.cpp src/QuranWords.cpp
    resources.qrc)
target_link_libraries(workflow-erp PRIVATE Qt6::Widgets Qt6::Network Qt6::PrintSupport)
if(WIN32)
    set_target_properties(workflow-erp PROPERTIES WIN32_EXECUTABLE ON)
endif()

# Headless smoke test (needs tools/mock_server.py running):  cmake -DWF_SMOKE_TEST=ON ...
option(WF_SMOKE_TEST "Build the smoke test" OFF)
if(WF_SMOKE_TEST)
    add_executable(smoke tests/smoke.cpp src/Api.cpp src/I18n.cpp src/Ui.cpp src/Pages.cpp src/RecordDialog.cpp src/MainWindow.cpp src/ChatPage.cpp src/WorkflowPage.cpp src/Prayer.cpp src/MuslimPage.cpp src/Forms.cpp src/MushafText.cpp src/Bi.cpp src/Charts.cpp src/Dashboard.cpp src/ReportDialog.cpp src/Pos.cpp src/Hospital.cpp src/CalendarPage.cpp src/Finance.cpp src/HrPage.cpp src/OpsPage.cpp src/SiteRender.cpp src/SitePage.cpp src/CustomPage.cpp src/AdminPage.cpp src/ActionsPage.cpp src/Xlsx.cpp src/QuranWords.cpp resources.qrc)
    target_link_libraries(smoke PRIVATE Qt6::Widgets Qt6::Network Qt6::PrintSupport)
endif()
