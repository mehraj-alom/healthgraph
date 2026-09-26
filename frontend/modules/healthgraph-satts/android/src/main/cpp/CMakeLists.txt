# healthgraph-satts native build (Android).
#
# Mirrors Ampixa/sanoTTS mobile/CMakeLists.txt (MIT): same sources, same
# include roots, same model-header mechanism — rooted at this module so the
# app needs no externalNativeBuild block. The model header dir carries the
# heartnano offsets header (lineage en_us_e13b; not interchangeable).
cmake_minimum_required(VERSION 3.18)
project(satts C)

set(CMAKE_C_STANDARD 99)
set(SATTS_CPP ${CMAKE_CURRENT_LIST_DIR})

add_library(satts SHARED
    ${SATTS_CPP}/sanotts.c
    ${SATTS_CPP}/snt_nano.c
    ${SATTS_CPP}/snt_kernels_ref.c
    ${SATTS_CPP}/snt_port_host.c
    ${SATTS_CPP}/satts_jni.c
)
target_include_directories(satts PUBLIC
    ${SATTS_CPP}
    ${SATTS_CPP}/model
)
target_link_libraries(satts log)
target_compile_definitions(satts PRIVATE FSD_FAST_MATH)
target_compile_options(satts PRIVATE -O2)
